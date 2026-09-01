import { computeNextDueDate, getTaskRecordResource, isValidTaskTarget, normalizeRecurrence, normalizeTaskAssigneeIds } from './task-utils.mjs';

/**
 * Tierramor API — Cloudflare Worker
 *
 * Proxy entre el frontend y Supabase/Google Drive.
 * Valida JWTs, oculta la service key, y aplica reglas de acceso por rol.
 *
 * Env secrets requeridos (wrangler secret put <NAME>):
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_JWT_SECRET,
 *   GOOGLE_DRIVE_SERVICE_ACCOUNT, GOOGLE_DRIVE_FOLDER_ID
 */

const ALLOWED_ORIGINS = [
  'https://jabdelnour95.github.io',
  'http://localhost:8080',
];

// ─── CORS ──────────────────────────────────────────────────────────────────

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

// ─── RESPONSE HELPERS ──────────────────────────────────────────────────────

function jsonResponse(request, body, status = 200) {
  const origin = request.headers.get('Origin') || '';
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

function okResponse(request, data, status = 200) {
  return jsonResponse(request, data, status);
}

function errResponse(request, code, message, status, details = null) {
  return jsonResponse(request, { error: { code, message, details } }, status);
}

// ─── JWT VALIDATION ────────────────────────────────────────────────────────

// Caché de JWKS en memoria del Worker (se invalida al redesplegar)
let cachedJwks = null;

async function fetchJwks(env) {
  if (cachedJwks) return cachedJwks;
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`);
  cachedJwks = await res.json();
  return cachedJwks;
}

function b64urlToBytes(b64url) {
  return Uint8Array.from(atob(b64url.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
}

async function validateJWT(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    return { ok: false, message: 'Token no proporcionado' };
  }

  const token = authHeader.slice(7);
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, message: 'Formato de token inválido' };

  const [headerB64, payloadB64, sigB64] = parts;

  try {
    const header = JSON.parse(atob(headerB64.replace(/-/g, '+').replace(/_/g, '/')));
    const sig = b64urlToBytes(sigB64);
    const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    let valid = false;

    if (header.alg === 'ES256') {
      // Supabase proyectos nuevos usan ES256 (ECDSA P-256)
      const jwks = await fetchJwks(env);
      const jwk = jwks.keys?.find(k => k.kid === header.kid);
      if (!jwk) return { ok: false, message: 'Clave de firma no encontrada (JWKS)' };
      const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, sig, data);
    } else if (header.alg === 'HS256') {
      // Proyectos legacy usan HS256
      const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.SUPABASE_JWT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
      valid = await crypto.subtle.verify('HMAC', key, sig, data);
    } else {
      return { ok: false, message: `Algoritmo JWT no soportado: ${header.alg}` };
    }

    if (!valid) return { ok: false, message: 'Firma de token inválida' };

    const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')));

    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return { ok: false, message: 'Token expirado. Por favor, iniciá sesión nuevamente.' };
    }

    // El JWT de Supabase tiene role="authenticated", no el rol de la app.
    // Fetcheamos el perfil para obtener el rol real (admin / field_worker / kitchen).
    const profileRes = await sbGet(env, 'profiles', `id=eq.${payload.sub}&select=role`);
    const profiles = await profileRes.json();
    const appRole = profiles[0]?.role ?? 'field_worker';

    return { ok: true, userId: payload.sub, email: payload.email, role: appRole };
  } catch {
    return { ok: false, message: 'Error al validar token' };
  }
}

// ─── SUPABASE HELPERS ──────────────────────────────────────────────────────

function sbHeaders(env) {
  return {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
  };
}

async function sbGet(env, path, params = '') {
  const qs = params ? `?${params}` : '';
  return fetch(`${env.SUPABASE_URL}/rest/v1/${path}${qs}`, {
    headers: sbHeaders(env),
  });
}

async function sbPost(env, path, body) {
  return fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: {
      ...sbHeaders(env),
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  });
}

async function sbPatch(env, path, filter, body) {
  return fetch(`${env.SUPABASE_URL}/rest/v1/${path}?${filter}`, {
    method: 'PATCH',
    headers: {
      ...sbHeaders(env),
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  });
}

async function sbDelete(env, path, filter) {
  return fetch(`${env.SUPABASE_URL}/rest/v1/${path}?${filter}`, {
    method: 'DELETE',
    headers: { ...sbHeaders(env), Prefer: 'return=representation' },
  });
}

async function sbAuthCall(env, endpoint, body) {
  return fetch(`${env.SUPABASE_URL}/auth/v1/${endpoint}`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_SERVICE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Proxy directo de una respuesta de Supabase al cliente.
async function proxySb(request, res) {
  const data = await res.json();
  if (!res.ok) {
    return errResponse(request, 'SUPABASE_ERROR', data.message || 'Error en base de datos', res.status, data);
  }
  return okResponse(request, data, res.status);
}

// Editar/borrar registros ya cargados (corrección de errores de carga) es admin-only.
function requireAdmin(request, auth) {
  if (auth.role !== 'admin') {
    return errResponse(request, 'FORBIDDEN', 'Solo un administrador puede editar o borrar registros', 403);
  }
  return null;
}

// ─── AUTH ──────────────────────────────────────────────────────────────────

async function handleAuth(request, env) {
  if (request.method !== 'POST') {
    return errResponse(request, 'METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }

  const url = new URL(request.url);
  const action = url.pathname.split('/').at(-1); // login | refresh | logout | reset-password
  const body = await request.json();

  if (action === 'login') {
    const res = await sbAuthCall(env, 'token?grant_type=password', {
      email: body.email,
      password: body.password,
    });
    const data = await res.json();
    if (!res.ok) return errResponse(request, 'UNAUTHORIZED', 'Credenciales inválidas', 401);

    const profileRes = await sbGet(
      env,
      'profiles',
      `id=eq.${data.user.id}&select=full_name,role,profile_departments(department)`,
    );
    const profiles = await profileRes.json();
    const profile = profiles[0];

    return okResponse(request, {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      user: {
        id: data.user.id,
        email: data.user.email,
        profile: {
          full_name: profile?.full_name,
          role: profile?.role,
          departments: profile?.profile_departments?.map(d => d.department) ?? [],
        },
      },
    });
  }

  if (action === 'refresh') {
    const res = await sbAuthCall(env, 'token?grant_type=refresh_token', {
      refresh_token: body.refresh_token,
    });
    const data = await res.json();
    if (!res.ok) return errResponse(request, 'UNAUTHORIZED', 'Refresh token inválido', 401);
    return okResponse(request, { access_token: data.access_token, refresh_token: data.refresh_token });
  }

  if (action === 'logout') {
    const authHeader = request.headers.get('Authorization') || '';
    await fetch(`${env.SUPABASE_URL}/auth/v1/logout`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: authHeader },
    });
    return okResponse(request, { success: true });
  }

  if (action === 'reset-password') {
    const res = await sbAuthCall(env, 'recover', { email: body.email });
    if (!res.ok) return errResponse(request, 'ERROR', 'Error al enviar email de recuperación', 500);
    return okResponse(request, { success: true });
  }

  // Self-service: el usuario logueado cambia su propia contraseña.
  // A diferencia de reset-password (flujo por email), acá no depende de que el
  // correo @tierramor.cr reciba nada — usa la sesión activa del usuario.
  if (action === 'change-password') {
    const auth = await validateJWT(request, env);
    if (!auth.ok) return errResponse(request, 'UNAUTHORIZED', auth.message, 401);

    const newPassword = body.new_password;
    if (!newPassword || newPassword.length < 6) {
      return errResponse(request, 'VALIDATION', 'La contraseña debe tener al menos 6 caracteres.', 400);
    }

    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      method: 'PUT',
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: request.headers.get('Authorization'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ password: newPassword }),
    });
    const data = await res.json();
    if (!res.ok) {
      const reason = data.msg || data.message || data.error_description || 'No se pudo actualizar la contraseña.';
      return errResponse(request, 'ERROR', reason, res.status);
    }
    return okResponse(request, { success: true });
  }

  return errResponse(request, 'NOT_FOUND', 'Ruta de auth no encontrada', 404);
}

// ─── USERS (solo admin) ────────────────────────────────────────────────────

async function handleUsers(request, env, auth) {
  if (auth.role !== 'admin') {
    return errResponse(request, 'FORBIDDEN', 'Solo administradores pueden gestionar usuarios', 403);
  }

  const segments = new URL(request.url).pathname.split('/').filter(Boolean);
  const userId = segments[2]; // undefined si es /api/users

  if (request.method === 'GET') {
    const res = await sbGet(
      env,
      'profiles',
      'select=*,profile_departments(department)&order=full_name.asc',
    );
    return proxySb(request, res);
  }

  if (request.method === 'POST') {
    const body = await request.json();

    // Crear usuario en Supabase Auth
    const createRes = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        ...sbHeaders(env),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: body.email, password: body.password, email_confirm: true }),
    });
    const userData = await createRes.json();
    if (!createRes.ok) {
      const reason = userData.msg || userData.message || userData.error_description || userData.error || JSON.stringify(userData);
      return errResponse(request, userData.error_code || 'ERROR', reason, createRes.status);
    }

    // El trigger en Supabase crea el perfil con valores por defecto; lo actualizamos
    // (el endpoint admin/users de Supabase devuelve el usuario directo, sin wrapper "user")
    await sbPatch(env, 'profiles', `id=eq.${userData.id}`, {
      full_name: body.full_name,
      role: body.role,
    });

    if (body.departments?.length) {
      const rows = body.departments.map(d => ({ profile_id: userData.id, department: d }));
      await sbPost(env, 'profile_departments', rows);
    }

    return okResponse(request, { id: userData.id }, 201);
  }

  if (request.method === 'PATCH' && userId) {
    const body = await request.json();
    const { departments, ...profileFields } = body;

    if (Object.keys(profileFields).length) {
      await sbPatch(env, 'profiles', `id=eq.${userId}`, profileFields);
    }

    if (departments !== undefined) {
      await sbDelete(env, 'profile_departments', `profile_id=eq.${userId}`);
      if (departments.length) {
        const rows = departments.map(d => ({ profile_id: userId, department: d }));
        await sbPost(env, 'profile_departments', rows);
      }
    }

    return okResponse(request, { success: true });
  }

  return errResponse(request, 'METHOD_NOT_ALLOWED', 'Método no permitido', 405);
}

// ─── CATALOGS ──────────────────────────────────────────────────────────────

const CATALOG_TABLE = {
  areas: 'productive_areas',
  subareas: 'productive_subareas',
  beds: 'beds',
  crops: 'crops',
  'bio-raw-materials': 'bio_raw_materials',
  'bio-finished-products': 'bio_finished_products',
  'nursery-species': 'nursery_species',
  'nursery-price-categories': 'nursery_price_categories',
  'nursery-raw-materials': 'nursery_raw_materials',
  'substrate-types': 'substrate_types',
  'container-types': 'container_types',
};

// Tables that don't have a 'name' column for ordering
const CATALOG_ORDER = {
  beds: 'code.asc',
  'nursery-price-categories': 'size_label.asc',
};

async function handleCatalogs(request, env, auth) {
  const segments = new URL(request.url).pathname.split('/').filter(Boolean);
  // segments: ['api', 'catalogs', ':resource', ':id?']
  const resource = segments[2];
  const itemId = segments[3];
  const table = CATALOG_TABLE[resource];

  if (!table) return errResponse(request, 'NOT_FOUND', 'Catálogo no encontrado', 404);

  if (request.method === 'GET') {
    const order = CATALOG_ORDER[resource] ?? 'name.asc';
    const res = await sbGet(env, table, `order=${order}`);
    return proxySb(request, res);
  }

  // Field workers can create new crops (but not edit or delete)
  if (auth.role !== 'admin') {
    if (request.method === 'POST' && resource === 'crops') {
      const res = await sbPost(env, table, await request.json());
      return proxySb(request, res);
    }
    return errResponse(request, 'FORBIDDEN', 'Solo admin puede modificar catálogos', 403);
  }

  if (request.method === 'POST') {
    const res = await sbPost(env, table, await request.json());
    return proxySb(request, res);
  }

  if (request.method === 'PATCH' && itemId) {
    const res = await sbPatch(env, table, `id=eq.${itemId}`, await request.json());
    return proxySb(request, res);
  }

  return errResponse(request, 'METHOD_NOT_ALLOWED', 'Método no permitido', 405);
}

// ─── FOOD PRODUCTION ───────────────────────────────────────────────────────

const FOOD_TABLE = {
  'planting-plans': 'planting_plans',
  'propagation-orders': 'propagation_orders',
  'area-maintenance': 'area_maintenance',
  harvests: 'harvests',
  invoices: 'internal_invoices_food',
  'kitchen-orders': 'kitchen_orders',
  availability: 'weekly_availability',
};

// Selects con joins legibles para el listado de registros (admin). Sin entrada acá,
// el GET genérico usa solo 'order=created_at.desc' (sin joins).
const FOOD_LIST_SELECT = {
  'area-maintenance': 'select=*,productive_areas(name)&',
  harvests: 'select=*,crops(name),productive_areas(name),beds(code)&',
};

async function handleFood(request, env, auth) {
  const segments = new URL(request.url).pathname.split('/').filter(Boolean);
  // segments: ['api', 'food', ':resource', ':id?', ':action?']
  const resource = segments[2];
  const itemId = segments[3];
  const action = segments[4];

  // ── bed-preparations (con array de inputs)
  if (resource === 'bed-preparations') {
    if (!itemId) {
      if (request.method === 'GET') {
        const res = await sbGet(env, 'bed_preparations', 'select=*,beds(code),bed_preparation_inputs(*)&order=date.desc');
        return proxySb(request, res);
      }
      if (request.method === 'POST') {
        const { inputs = [], ...fields } = await request.json();
        const prepRes = await sbPost(env, 'bed_preparations', fields);
        if (!prepRes.ok) return proxySb(request, prepRes);
        const prep = (await prepRes.json())[0];
        if (inputs.length) {
          await sbPost(env, 'bed_preparation_inputs', inputs.map(i => ({ ...i, preparation_id: prep.id })));
        }
        return okResponse(request, prep, 201);
      }
    } else {
      if (request.method === 'PATCH') {
        const forbidden = requireAdmin(request, auth); if (forbidden) return forbidden;
        const { inputs, ...fields } = await request.json();
        if (Object.keys(fields).length) await sbPatch(env, 'bed_preparations', `id=eq.${itemId}`, fields);
        if (inputs) {
          await sbDelete(env, 'bed_preparation_inputs', `preparation_id=eq.${itemId}`);
          if (inputs.length) await sbPost(env, 'bed_preparation_inputs', inputs.map(i => ({ ...i, preparation_id: itemId })));
        }
        const res = await sbGet(env, 'bed_preparations', `id=eq.${itemId}&select=*,bed_preparation_inputs(*)`);
        return proxySb(request, res);
      }
      if (request.method === 'DELETE') {
        const forbidden = requireAdmin(request, auth); if (forbidden) return forbidden;
        const res = await sbDelete(env, 'bed_preparations', `id=eq.${itemId}`);
        return proxySb(request, res);
      }
    }
  }

  // ── plantings (lot_id generado por trigger en DB)
  if (resource === 'plantings') {
    if (!itemId) {
      if (request.method === 'GET') {
        const res = await sbGet(env, 'plantings', 'select=*,crops(name),beds(code)&order=date.desc');
        return proxySb(request, res);
      }
      if (request.method === 'POST') {
        const res = await sbPost(env, 'plantings', await request.json());
        return proxySb(request, res);
      }
    } else {
      if (request.method === 'PATCH') {
        const forbidden = requireAdmin(request, auth); if (forbidden) return forbidden;
        const res = await sbPatch(env, 'plantings', `id=eq.${itemId}`, await request.json());
        return proxySb(request, res);
      }
      if (request.method === 'DELETE') {
        const forbidden = requireAdmin(request, auth); if (forbidden) return forbidden;
        const res = await sbDelete(env, 'plantings', `id=eq.${itemId}`);
        return proxySb(request, res);
      }
    }
  }

  // ── input-applications (con array de items)
  if (resource === 'input-applications') {
    if (!itemId) {
      if (request.method === 'GET') {
        const res = await sbGet(env, 'input_applications', 'select=*,productive_areas(name),input_application_items(*)&order=date.desc');
        return proxySb(request, res);
      }
      if (request.method === 'POST') {
        const { items = [], ...fields } = await request.json();
        const appRes = await sbPost(env, 'input_applications', fields);
        if (!appRes.ok) return proxySb(request, appRes);
        const app = (await appRes.json())[0];
        if (items.length) {
          await sbPost(env, 'input_application_items', items.map(i => ({ ...i, application_id: app.id })));
        }
        return okResponse(request, app, 201);
      }
    } else {
      if (request.method === 'PATCH') {
        const forbidden = requireAdmin(request, auth); if (forbidden) return forbidden;
        const { items, ...fields } = await request.json();
        if (Object.keys(fields).length) await sbPatch(env, 'input_applications', `id=eq.${itemId}`, fields);
        if (items) {
          await sbDelete(env, 'input_application_items', `application_id=eq.${itemId}`);
          if (items.length) await sbPost(env, 'input_application_items', items.map(i => ({ ...i, application_id: itemId })));
        }
        const res = await sbGet(env, 'input_applications', `id=eq.${itemId}&select=*,input_application_items(*)`);
        return proxySb(request, res);
      }
      if (request.method === 'DELETE') {
        const forbidden = requireAdmin(request, auth); if (forbidden) return forbidden;
        const res = await sbDelete(env, 'input_applications', `id=eq.${itemId}`);
        return proxySb(request, res);
      }
    }
  }

  // ── availability/check (verificar si ya existe para una semana)
  if (resource === 'availability' && itemId === 'check' && request.method === 'POST') {
    const { week_ref } = await request.json();
    const res = await sbGet(env, 'weekly_availability', `week_ref=eq.${week_ref}&select=id,status`);
    const rows = await res.json();
    return okResponse(request, { exists: rows.length > 0, id: rows[0]?.id ?? null, status: rows[0]?.status ?? null });
  }

  // ── availability/:id/publish
  if (resource === 'availability' && action === 'publish' && request.method === 'PATCH') {
    const res = await sbPatch(env, 'weekly_availability', `id=eq.${itemId}`, { status: 'published' });
    return proxySb(request, res);
  }

  // ── kitchen-orders/:id/confirm
  if (resource === 'kitchen-orders' && action === 'confirm' && request.method === 'PATCH') {
    const res = await sbPatch(env, 'kitchen_orders', `id=eq.${itemId}`, { status: 'confirmed' });
    return proxySb(request, res);
  }

  // ── availability (create with items array) — must come before generic FOOD_TABLE handler
  if (resource === 'availability' && !itemId && request.method === 'POST') {
    const { items = [], ...fields } = await request.json();
    const availRes = await sbPost(env, 'weekly_availability', fields);
    if (!availRes.ok) return proxySb(request, availRes);
    const avail = (await availRes.json())[0];
    if (items.length) {
      await sbPost(env, 'weekly_availability_items', items.map(i => ({ ...i, availability_id: avail.id })));
    }
    return okResponse(request, avail, 201);
  }

  // ── availability/:id (editar/borrar, admin) — distinto de /:id/publish arriba
  if (resource === 'availability' && itemId && !action) {
    if (request.method === 'PATCH') {
      const forbidden = requireAdmin(request, auth); if (forbidden) return forbidden;
      const { items, ...fields } = await request.json();
      if (Object.keys(fields).length) await sbPatch(env, 'weekly_availability', `id=eq.${itemId}`, fields);
      if (items) {
        await sbDelete(env, 'weekly_availability_items', `availability_id=eq.${itemId}`);
        if (items.length) await sbPost(env, 'weekly_availability_items', items.map(i => ({ ...i, availability_id: itemId })));
      }
      const res = await sbGet(env, 'weekly_availability', `id=eq.${itemId}&select=*,weekly_availability_items(*)`);
      return proxySb(request, res);
    }
    if (request.method === 'DELETE') {
      const forbidden = requireAdmin(request, auth); if (forbidden) return forbidden;
      const res = await sbDelete(env, 'weekly_availability', `id=eq.${itemId}`);
      return proxySb(request, res);
    }
  }

  // ── recursos simples con GET/POST/PATCH/DELETE genérico
  const table = FOOD_TABLE[resource];
  if (table) {
    if (request.method === 'GET') {
      const select = resource === 'availability'
        ? 'select=*,weekly_availability_items(*)&'
        : (FOOD_LIST_SELECT[resource] || '');
      const res = await sbGet(env, table, `${select}order=created_at.desc`);
      return proxySb(request, res);
    }
    if (request.method === 'POST') {
      const res = await sbPost(env, table, await request.json());
      return proxySb(request, res);
    }
    if (itemId && request.method === 'PATCH') {
      const forbidden = requireAdmin(request, auth); if (forbidden) return forbidden;
      const res = await sbPatch(env, table, `id=eq.${itemId}`, await request.json());
      return proxySb(request, res);
    }
    if (itemId && request.method === 'DELETE') {
      const forbidden = requireAdmin(request, auth); if (forbidden) return forbidden;
      // harvests → internal_invoices_food no tiene ON DELETE CASCADE (ver Docs/TDD.md);
      // hay que borrar la factura generada por el trigger antes de borrar la cosecha.
      if (resource === 'harvests') {
        await sbDelete(env, 'internal_invoices_food', `harvest_id=eq.${itemId}`);
      }
      const res = await sbDelete(env, table, `id=eq.${itemId}`);
      return proxySb(request, res);
    }
  }

  return errResponse(request, 'NOT_FOUND', 'Ruta no encontrada', 404);
}

// ─── BIOFACTORY ────────────────────────────────────────────────────────────

async function handleBio(request, env, auth) {
  const segments = new URL(request.url).pathname.split('/').filter(Boolean);
  const resource = segments[2];
  const itemId = segments[3];
  const action = segments[4];

  // ── raw-material-entries
  if (resource === 'raw-material-entries') {
    if (request.method === 'GET') {
      const res = await sbGet(env, 'bio_raw_material_entries', 'select=*,bio_raw_materials(name)&order=date.desc');
      return proxySb(request, res);
    }
    if (request.method === 'POST') {
      const res = await sbPost(env, 'bio_raw_material_entries', await request.json());
      return proxySb(request, res);
    }
    if (itemId && request.method === 'PATCH') {
      const forbidden = requireAdmin(request, auth); if (forbidden) return forbidden;
      const res = await sbPatch(env, 'bio_raw_material_entries', `id=eq.${itemId}`, await request.json());
      return proxySb(request, res);
    }
    if (itemId && request.method === 'DELETE') {
      const forbidden = requireAdmin(request, auth); if (forbidden) return forbidden;
      const res = await sbDelete(env, 'bio_raw_material_entries', `id=eq.${itemId}`);
      return proxySb(request, res);
    }
  }

  // ── batches
  if (resource === 'batches') {
    if (!itemId) {
      if (request.method === 'GET') {
        const res = await sbGet(env, 'bio_production_batches', 'select=*,bio_finished_products(name),bio_production_batch_inputs(*)&order=date_start.desc');
        return proxySb(request, res);
      }
      if (request.method === 'POST') {
        const { inputs = [], ...fields } = await request.json();
        const batchRes = await sbPost(env, 'bio_production_batches', fields);
        if (!batchRes.ok) return proxySb(request, batchRes);
        const batch = (await batchRes.json())[0];
        if (inputs.length) {
          await sbPost(env, 'bio_production_batch_inputs', inputs.map(i => ({ ...i, batch_id: batch.id })));
        }
        return okResponse(request, batch, 201);
      }
    }

    // PATCH /api/bio/batches/:id/close — valida stock antes de cerrar (D-001)
    if (action === 'close' && request.method === 'PATCH') {
      const body = await request.json();

      const [inputsRes, ...stockRess] = await (async () => {
        const iRes = await sbGet(env, 'bio_production_batch_inputs', `batch_id=eq.${itemId}&select=raw_material_id,quantity`);
        const inputs = await iRes.json();
        const sRess = await Promise.all(
          inputs.map(i =>
            sbGet(env, 'v_bio_raw_material_stock', `id=eq.${i.raw_material_id}&select=id,name,current_stock`),
          ),
        );
        return [inputs, ...sRess];
      })();

      const stockRows = await Promise.all(stockRess.map(r => r.json()));

      const warnings = inputsRes
        .map((input, idx) => {
          const stock = stockRows[idx][0];
          if (stock && stock.current_stock < input.quantity) {
            return { raw_material_id: input.raw_material_id, name: stock.name, required: input.quantity, available: stock.current_stock };
          }
          return null;
        })
        .filter(Boolean);

      const closeRes = await sbPatch(env, 'bio_production_batches', `id=eq.${itemId}`, { ...body, status: 'closed' });
      if (!closeRes.ok) return proxySb(request, closeRes);

      return okResponse(request, {
        warning: warnings.length > 0,
        items: warnings,
        batch: (await closeRes.json())[0],
      });
    }

    // PATCH/DELETE /api/bio/batches/:id (editar/borrar, admin) — distinto de /:id/close arriba
    if (itemId && !action) {
      if (request.method === 'PATCH') {
        const forbidden = requireAdmin(request, auth); if (forbidden) return forbidden;
        const { inputs, ...fields } = await request.json();
        if (Object.keys(fields).length) await sbPatch(env, 'bio_production_batches', `id=eq.${itemId}`, fields);
        if (inputs) {
          await sbDelete(env, 'bio_production_batch_inputs', `batch_id=eq.${itemId}`);
          if (inputs.length) await sbPost(env, 'bio_production_batch_inputs', inputs.map(i => ({ ...i, batch_id: itemId })));
        }
        const res = await sbGet(env, 'bio_production_batches', `id=eq.${itemId}&select=*,bio_production_batch_inputs(*)`);
        return proxySb(request, res);
      }
      if (request.method === 'DELETE') {
        const forbidden = requireAdmin(request, auth); if (forbidden) return forbidden;
        const res = await sbDelete(env, 'bio_production_batches', `id=eq.${itemId}`);
        return proxySb(request, res);
      }
    }
  }

  // ── outputs
  if (resource === 'outputs') {
    if (request.method === 'GET') {
      const res = await sbGet(env, 'bio_finished_product_outputs', 'select=*,bio_finished_products(name)&order=date.desc');
      return proxySb(request, res);
    }
    if (request.method === 'POST') {
      const res = await sbPost(env, 'bio_finished_product_outputs', await request.json());
      return proxySb(request, res);
    }
    if (itemId && request.method === 'PATCH') {
      const forbidden = requireAdmin(request, auth); if (forbidden) return forbidden;
      const res = await sbPatch(env, 'bio_finished_product_outputs', `id=eq.${itemId}`, await request.json());
      return proxySb(request, res);
    }
    if (itemId && request.method === 'DELETE') {
      const forbidden = requireAdmin(request, auth); if (forbidden) return forbidden;
      // outputs (venta externa) → bio_external_invoices no tiene ON DELETE CASCADE
      // (ver Docs/TDD.md); hay que borrar la factura generada por el trigger primero.
      await sbDelete(env, 'bio_external_invoices', `output_id=eq.${itemId}`);
      const res = await sbDelete(env, 'bio_finished_product_outputs', `id=eq.${itemId}`);
      return proxySb(request, res);
    }
  }

  // ── invoices
  if (resource === 'invoices' && request.method === 'GET') {
    const res = await sbGet(env, 'bio_external_invoices', 'order=created_at.desc');
    return proxySb(request, res);
  }

  return errResponse(request, 'NOT_FOUND', 'Ruta no encontrada', 404);
}

// ─── NURSERY ───────────────────────────────────────────────────────────────

const NURSERY_LOT_SUB = {
  'germination-tracking': 'germination_tracking',
  'establishment-count': 'establishment_counts',
  maintenance: 'lot_maintenance',
  'plant-counts': 'plant_counts',
  graduations: 'lot_graduations',
  outputs: 'plant_lot_outputs',
};

async function handleNursery(request, env, auth) {
  const segments = new URL(request.url).pathname.split('/').filter(Boolean);
  const resource = segments[2];
  const itemId = segments[3];
  const action = segments[4];

  // ── raw-material-entries
  if (resource === 'raw-material-entries') {
    if (request.method === 'GET') {
      const res = await sbGet(env, 'nursery_raw_material_entries', 'select=*,nursery_raw_materials(name)&order=date.desc');
      return proxySb(request, res);
    }
    if (request.method === 'POST') {
      const res = await sbPost(env, 'nursery_raw_material_entries', await request.json());
      return proxySb(request, res);
    }
    if (itemId && request.method === 'PATCH') {
      const forbidden = requireAdmin(request, auth); if (forbidden) return forbidden;
      const res = await sbPatch(env, 'nursery_raw_material_entries', `id=eq.${itemId}`, await request.json());
      return proxySb(request, res);
    }
    if (itemId && request.method === 'DELETE') {
      const forbidden = requireAdmin(request, auth); if (forbidden) return forbidden;
      const res = await sbDelete(env, 'nursery_raw_material_entries', `id=eq.${itemId}`);
      return proxySb(request, res);
    }
  }

  // ── substrate-batches (con array de components)
  if (resource === 'substrate-batches') {
    if (request.method === 'GET') {
      const res = await sbGet(env, 'substrate_batches', 'select=*,substrate_types(name,code),substrate_batch_components(*)&order=date.desc');
      return proxySb(request, res);
    }
    if (request.method === 'POST') {
      const { components = [], ...fields } = await request.json();
      const batchRes = await sbPost(env, 'substrate_batches', fields);
      if (!batchRes.ok) return proxySb(request, batchRes);
      const batch = (await batchRes.json())[0];
      if (components.length) {
        await sbPost(env, 'substrate_batch_components', components.map(c => ({ ...c, batch_id: batch.id })));
      }
      return okResponse(request, batch, 201);
    }
    if (itemId && request.method === 'PATCH') {
      const forbidden = requireAdmin(request, auth); if (forbidden) return forbidden;
      const { components, ...fields } = await request.json();
      if (Object.keys(fields).length) await sbPatch(env, 'substrate_batches', `id=eq.${itemId}`, fields);
      if (components) {
        await sbDelete(env, 'substrate_batch_components', `batch_id=eq.${itemId}`);
        if (components.length) await sbPost(env, 'substrate_batch_components', components.map(c => ({ ...c, batch_id: itemId })));
      }
      const res = await sbGet(env, 'substrate_batches', `id=eq.${itemId}&select=*,substrate_batch_components(*)`);
      return proxySb(request, res);
    }
    if (itemId && request.method === 'DELETE') {
      const forbidden = requireAdmin(request, auth); if (forbidden) return forbidden;
      const res = await sbDelete(env, 'substrate_batches', `id=eq.${itemId}`);
      return proxySb(request, res);
    }
  }

  // ── container-fills
  if (resource === 'container-fills') {
    if (request.method === 'GET') {
      const res = await sbGet(env, 'container_fills', 'select=*,container_types(name),substrate_batches(batch_id)&order=date.desc');
      return proxySb(request, res);
    }
    if (request.method === 'POST') {
      const res = await sbPost(env, 'container_fills', await request.json());
      return proxySb(request, res);
    }
    if (itemId && request.method === 'PATCH') {
      const forbidden = requireAdmin(request, auth); if (forbidden) return forbidden;
      const res = await sbPatch(env, 'container_fills', `id=eq.${itemId}`, await request.json());
      return proxySb(request, res);
    }
    if (itemId && request.method === 'DELETE') {
      const forbidden = requireAdmin(request, auth); if (forbidden) return forbidden;
      const res = await sbDelete(env, 'container_fills', `id=eq.${itemId}`);
      return proxySb(request, res);
    }
  }

  // ── lots
  if (resource === 'lots') {
    // GET/POST /api/nursery/lots
    if (!itemId) {
      if (request.method === 'GET') {
        const res = await sbGet(env, 'plant_lots', 'select=*,nursery_species(name),container_types(name)&order=date_start.desc');
        return proxySb(request, res);
      }
      if (request.method === 'POST') {
        const res = await sbPost(env, 'plant_lots', await request.json());
        return proxySb(request, res);
      }
    }

    // PATCH/DELETE /api/nursery/lots/:id (editar/borrar, admin)
    if (itemId && !action && request.method === 'PATCH') {
      const forbidden = requireAdmin(request, auth); if (forbidden) return forbidden;
      const res = await sbPatch(env, 'plant_lots', `id=eq.${itemId}`, await request.json());
      return proxySb(request, res);
    }
    if (itemId && !action && request.method === 'DELETE') {
      const forbidden = requireAdmin(request, auth); if (forbidden) return forbidden;
      // Las 6 tablas satélite del lote referencian plant_lots SIN ON DELETE CASCADE
      // (ver Docs/TDD.md) — hay que limpiarlas primero o el DELETE falla por FK.
      await Promise.all(Object.values(NURSERY_LOT_SUB).map(table => sbDelete(env, table, `lot_id=eq.${itemId}`)));
      const res = await sbDelete(env, 'plant_lots', `id=eq.${itemId}`);
      return proxySb(request, res);
    }

    // GET /api/nursery/lots/:id — detalle completo
    if (itemId && !action && request.method === 'GET') {
      const [lotRes, germRes, estRes, maintRes, countRes, gradRes, outRes] = await Promise.all([
        sbGet(env, 'plant_lots', `id=eq.${itemId}&select=*,nursery_species(*),container_types(*)`),
        sbGet(env, 'germination_tracking', `lot_id=eq.${itemId}&order=date.asc`),
        sbGet(env, 'establishment_counts', `lot_id=eq.${itemId}&order=date.desc&limit=1`),
        sbGet(env, 'lot_maintenance', `lot_id=eq.${itemId}&order=date.desc`),
        sbGet(env, 'plant_counts', `lot_id=eq.${itemId}&order=date.desc`),
        sbGet(env, 'lot_graduations', `lot_id=eq.${itemId}&order=date.desc`),
        sbGet(env, 'plant_lot_outputs', `lot_id=eq.${itemId}&order=date.desc`),
      ]);

      const [lot, germination, establishment, maintenance, plant_counts, graduations, outputs] = await Promise.all([
        lotRes.json(),
        germRes.json(),
        estRes.json(),
        maintRes.json(),
        countRes.json(),
        gradRes.json(),
        outRes.json(),
      ]);

      return okResponse(request, {
        lot: lot[0] ?? null,
        germination_tracking: germination,
        establishment_count: establishment[0] ?? null,
        maintenance,
        plant_counts,
        graduations,
        outputs,
      });
    }

    // POST /api/nursery/lots/:id/:action — sub-recursos del lote
    if (itemId && action && request.method === 'POST') {
      const table = NURSERY_LOT_SUB[action];
      if (!table) return errResponse(request, 'NOT_FOUND', 'Sub-recurso de lote no encontrado', 404);
      const body = await request.json();
      const res = await sbPost(env, table, { ...body, lot_id: itemId });
      return proxySb(request, res);
    }
  }

  // ── quotations
  if (resource === 'quotations') {
    if (!itemId) {
      if (request.method === 'GET') {
        const res = await sbGet(env, 'quotations', 'select=*,quotation_items(*)&order=created_at.desc');
        return proxySb(request, res);
      }
      if (request.method === 'POST') {
        const { items = [], ...fields } = await request.json();
        const quoteRes = await sbPost(env, 'quotations', fields);
        if (!quoteRes.ok) return proxySb(request, quoteRes);
        const quote = (await quoteRes.json())[0];
        if (items.length) {
          await sbPost(env, 'quotation_items', items.map(it => ({ ...it, quotation_id: quote.id })));
        }
        return okResponse(request, quote, 201);
      }
    }
    // PATCH /api/nursery/quotations/:id/status
    if (itemId && action === 'status' && request.method === 'PATCH') {
      const { status } = await request.json();
      const fields = { status };
      if (status === 'accepted') fields.accepted_at = new Date().toISOString();
      const res = await sbPatch(env, 'quotations', `id=eq.${itemId}`, fields);
      return proxySb(request, res);
    }
  }

  return errResponse(request, 'NOT_FOUND', 'Ruta no encontrada', 404);
}

// ─── INVENTORY (vistas de stock) ───────────────────────────────────────────

const INVENTORY_VIEW = {
  'bio-raw': 'v_bio_raw_material_stock',
  'bio-finished': 'v_bio_finished_product_stock',
  substrates: 'v_nursery_substrate_stock',
  containers: 'v_nursery_container_stock',
  'nursery-raw': 'v_nursery_raw_material_stock',
};

async function handleInventory(request, env, auth) {
  if (request.method !== 'GET') {
    return errResponse(request, 'METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }
  const resource = new URL(request.url).pathname.split('/').filter(Boolean)[2];
  const view = INVENTORY_VIEW[resource];
  if (!view) return errResponse(request, 'NOT_FOUND', 'Vista de inventario no encontrada', 404);
  const res = await sbGet(env, view, 'order=name.asc');
  return proxySb(request, res);
}

// ─── TASKS ────────────────────────────────────────────────────────────────

async function _attachTaskNames(env, tasks) {
  const ids = [...new Set(tasks.flatMap(task => [task.assigned_to, task.assigned_by]).filter(Boolean))];
  if (!ids.length) return tasks;
  const res = await sbGet(env, 'profiles', `id=in.(${ids.join(',')})&select=id,full_name`);
  const profiles = await res.json();
  const names = Object.fromEntries((profiles || []).map(p => [p.id, p.full_name]));
  return tasks.map(task => ({
    ...task,
    assigned_to_name: names[task.assigned_to] || null,
    assigned_by_name: names[task.assigned_by] || null,
  }));
}

function _validateTaskBody(body) {
  if (!body.title?.trim()) return 'Ingresá un título para la tarea.';
  if (!normalizeTaskAssigneeIds(body.assigned_to).length) return 'Seleccioná al menos una persona para la tarea.';
  if (!body.due_date) return 'Ingresá la fecha límite.';
  if (!isValidTaskTarget(body.module_key, body.form_key)) return 'La combinación módulo/formulario no es válida.';
  const recurrence = normalizeRecurrence(body.recurrence || 'none');
  if (!recurrence) return 'La recurrencia seleccionada no es válida.';
  return null;
}

async function handleTasks(request, env, auth) {
  const segments = new URL(request.url).pathname.split('/').filter(Boolean);
  const itemId = segments[2];
  const action = segments[3];
  const url = new URL(request.url);

  if (!itemId && request.method === 'GET') {
    const requestedScope = url.searchParams.get('scope') || 'mine';
    const scope = auth.role === 'admin' ? requestedScope : 'mine';
    const status = url.searchParams.get('status') || 'pending';
    const filters = [];

    if (scope !== 'all') filters.push(`assigned_to=eq.${auth.userId}`);
    if (status !== 'all') filters.push(`status=eq.${status}`);

    const params = `${filters.join('&')}${filters.length ? '&' : ''}order=due_date.asc`;
    const res = await sbGet(env, 'assigned_tasks', params);
    if (!res.ok) return proxySb(request, res);
    const rows = await res.json();
    return okResponse(request, await _attachTaskNames(env, rows));
  }

  if (!itemId && request.method === 'POST') {
    if (auth.role !== 'admin') {
      return errResponse(request, 'FORBIDDEN', 'Solo un administrador puede asignar tareas', 403);
    }

    const body = await request.json();
    const validationError = _validateTaskBody(body);
    if (validationError) return errResponse(request, 'VALIDATION_ERROR', validationError, 400);

    const assigneeIds = normalizeTaskAssigneeIds(body.assigned_to);
    const assigneeRes = await sbGet(env, 'profiles', `id=in.(${assigneeIds.join(',')})&select=id,role`);
    if (!assigneeRes.ok) return proxySb(request, assigneeRes);
    const assignees = await assigneeRes.json();
    if (assignees.length !== assigneeIds.length) {
      return errResponse(request, 'VALIDATION_ERROR', 'Una de las personas asignadas no existe.', 400);
    }
    if (assignees.some(assignee => assignee.role === 'admin')) {
      return errResponse(request, 'VALIDATION_ERROR', 'Las tareas deben asignarse a cuentas no-admin.', 400);
    }

    const recurrence = normalizeRecurrence(body.recurrence || 'none');
    const record_resource = getTaskRecordResource(body.module_key, body.form_key);
    // Each assignee gets an independent task so completion and recurrence stay personal.
    const createRes = await sbPost(env, 'assigned_tasks', assigneeIds.map(assigned_to => ({
      title: body.title.trim(),
      description: body.description?.trim() || null,
      assigned_to,
      assigned_by: auth.userId,
      module_key: body.module_key,
      form_key: body.form_key,
      record_resource,
      due_date: body.due_date,
      recurrence,
      status: 'pending',
    })));
    if (!createRes.ok) return proxySb(request, createRes);
    const created = await createRes.json();
    return okResponse(request, await _attachTaskNames(env, created), 201);
  }

  if (itemId && !action && request.method === 'PATCH') {
    if (auth.role !== 'admin') {
      return errResponse(request, 'FORBIDDEN', 'Solo un administrador puede editar tareas', 403);
    }

    const body = await request.json();
    const validationError = _validateTaskBody(body);
    if (validationError) return errResponse(request, 'VALIDATION_ERROR', validationError, 400);

    const assigneeIds = normalizeTaskAssigneeIds(body.assigned_to);
    if (assigneeIds.length !== 1) {
      return errResponse(request, 'VALIDATION_ERROR', 'Una tarea existente solo puede tener una persona asignada.', 400);
    }
    const assigneeRes = await sbGet(env, 'profiles', `id=eq.${assigneeIds[0]}&select=id,role&limit=1`);
    if (!assigneeRes.ok) return proxySb(request, assigneeRes);
    const assignee = (await assigneeRes.json())[0];
    if (!assignee) return errResponse(request, 'VALIDATION_ERROR', 'La persona asignada no existe.', 400);
    if (assignee.role === 'admin') {
      return errResponse(request, 'VALIDATION_ERROR', 'Las tareas deben asignarse a cuentas no-admin.', 400);
    }

    const recurrence = normalizeRecurrence(body.recurrence || 'none');
    const updateRes = await sbPatch(env, 'assigned_tasks', `id=eq.${itemId}&status=eq.pending`, {
      title: body.title.trim(),
      description: body.description?.trim() || null,
      assigned_to: assigneeIds[0],
      module_key: body.module_key,
      form_key: body.form_key,
      record_resource: getTaskRecordResource(body.module_key, body.form_key),
      due_date: body.due_date,
      recurrence,
    });
    if (!updateRes.ok) return proxySb(request, updateRes);
    const updated = (await updateRes.json())[0];
    if (!updated) return errResponse(request, 'CONFLICT', 'La tarea no existe o ya fue completada.', 409);
    return okResponse(request, (await _attachTaskNames(env, [updated]))[0]);
  }

  if (itemId && !action && request.method === 'DELETE') {
    if (auth.role !== 'admin') {
      return errResponse(request, 'FORBIDDEN', 'Solo un administrador puede eliminar tareas', 403);
    }
    // Keep an already-created recurrence usable when its previous instance is removed.
    const unlinkRes = await sbPatch(env, 'assigned_tasks', `source_task_id=eq.${itemId}`, { source_task_id: null });
    if (!unlinkRes.ok) return proxySb(request, unlinkRes);
    const deleteRes = await sbDelete(env, 'assigned_tasks', `id=eq.${itemId}`);
    if (!deleteRes.ok) return proxySb(request, deleteRes);
    const deleted = (await deleteRes.json())[0];
    if (!deleted) return errResponse(request, 'NOT_FOUND', 'Tarea no encontrada', 404);
    return okResponse(request, { task: deleted });
  }

  if (itemId && action === 'complete' && request.method === 'PATCH') {
    const currentRes = await sbGet(env, 'assigned_tasks', `id=eq.${itemId}&limit=1`);
    if (!currentRes.ok) return proxySb(request, currentRes);
    const currentRows = await currentRes.json();
    const task = currentRows[0];
    if (!task) return errResponse(request, 'NOT_FOUND', 'Tarea no encontrada', 404);
    if (auth.role !== 'admin' && task.assigned_to !== auth.userId) {
      return errResponse(request, 'FORBIDDEN', 'Solo la persona asignada puede completar esta tarea', 403);
    }
    if (task.status !== 'pending') {
      return errResponse(request, 'VALIDATION_ERROR', 'La tarea ya no está pendiente', 409);
    }

    const body = await request.json();
    if (!body.completed_record_id) {
      return errResponse(request, 'VALIDATION_ERROR', 'Falta el registro que completó la tarea', 400);
    }

    const completedAt = new Date().toISOString();
    const completeRes = await sbPatch(env, 'assigned_tasks', `id=eq.${itemId}`, {
      status: 'completed',
      completed_at: completedAt,
      completed_by: auth.userId,
      completed_record_id: body.completed_record_id,
      completed_record_resource: task.record_resource,
    });
    if (!completeRes.ok) return proxySb(request, completeRes);
    const completed = (await completeRes.json())[0];

    let nextTask = null;
    const nextDueDate = computeNextDueDate(task.due_date, task.recurrence);
    if (nextDueDate) {
      const nextRes = await sbPost(env, 'assigned_tasks', {
        title: task.title,
        description: task.description,
        assigned_to: task.assigned_to,
        assigned_by: task.assigned_by,
        module_key: task.module_key,
        form_key: task.form_key,
        record_resource: task.record_resource,
        due_date: nextDueDate,
        recurrence: task.recurrence,
        status: 'pending',
        source_task_id: task.id,
      });
      if (nextRes.ok) nextTask = (await nextRes.json())[0];
    }

    const [hydratedCompleted] = await _attachTaskNames(env, [completed]);
    const hydratedNext = nextTask ? (await _attachTaskNames(env, [nextTask]))[0] : null;
    return okResponse(request, { task: hydratedCompleted, next_task: hydratedNext });
  }

  return errResponse(request, 'METHOD_NOT_ALLOWED', 'Método no permitido', 405);
}

// ─── FARM WORKERS ──────────────────────────────────────────────────────────

async function handleFarmWorkers(request, env, auth) {
  if (request.method !== 'GET') {
    return errResponse(request, 'METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }
  const res = await sbGet(env, 'farm_workers', 'active=eq.true&order=name.asc');
  return proxySb(request, res);
}

// ─── GOOGLE DRIVE (fotos) ───────────────────────────────────────────────────

// Caché del access token de la service account en memoria del Worker
// (se invalida al redesplegar, igual que cachedJwks).
let cachedGoogleToken = null;

function base64urlFromBytes(bytes) {
  let binary = '';
  bytes.forEach(b => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlFromString(str) {
  return base64urlFromBytes(new TextEncoder().encode(str));
}

function pemToArrayBuffer(pem) {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// Obtiene (y cachea) un access token OAuth2 para la service account de Google Drive,
// firmando un JWT RS256 propio (grant type jwt-bearer) — no hay librería OAuth2 en Workers.
async function getGoogleAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedGoogleToken && cachedGoogleToken.expires > now + 60) {
    return cachedGoogleToken.token;
  }

  const sa = JSON.parse(env.GOOGLE_DRIVE_SERVICE_ACCOUNT);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/drive',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const signingInput = `${base64urlFromString(JSON.stringify(header))}.${base64urlFromString(JSON.stringify(claim))}`;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput));
  const assertion = `${signingInput}.${base64urlFromBytes(new Uint8Array(signature))}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok) throw new Error(`Google OAuth error: ${JSON.stringify(tokenData)}`);

  cachedGoogleToken = { token: tokenData.access_token, expires: now + tokenData.expires_in };
  return tokenData.access_token;
}

// Sube un archivo a Drive vía multipart/related (metadata JSON + bytes del archivo en un solo body).
async function uploadFileToDrive(env, accessToken, file, fileName) {
  const metadata = { name: fileName, parents: [env.GOOGLE_DRIVE_FOLDER_ID] };
  const boundary = `tierramor-${crypto.randomUUID()}`;
  const encoder = new TextEncoder();
  const fileBuffer = await file.arrayBuffer();

  const body = new Blob([
    encoder.encode(
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: ${file.type || 'application/octet-stream'}\r\n\r\n`,
    ),
    fileBuffer,
    encoder.encode(`\r\n--${boundary}--`),
  ]);

  // supportsAllDrives=true es obligatorio para escribir en carpetas de una Shared Drive
  // (la carpeta "Fotos App" vive en una Shared Drive, no en el My Drive de un usuario)
  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id&supportsAllDrives=true', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Drive upload error: ${JSON.stringify(data)}`);
  return data.id;
}

// Hace público el archivo (cualquiera con el link puede ver) para que la URL sirva directo en el app.
async function makeDriveFilePublic(accessToken, fileId) {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions?supportsAllDrives=true`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'reader', type: 'anyone' }),
  });
  if (!res.ok) throw new Error(`Drive permission error: ${JSON.stringify(await res.json())}`);
}

// ─── PHOTOS ────────────────────────────────────────────────────────────────

async function handlePhotos(request, env, auth) {
  if (request.method !== 'POST') {
    return errResponse(request, 'METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }

  const formData = await request.formData();
  const file = formData.get('file');
  if (!file || typeof file === 'string') {
    return errResponse(request, 'VALIDATION_ERROR', 'No se recibió ningún archivo', 400);
  }

  const department = String(formData.get('department') ?? 'general').replace(/[^a-zA-Z0-9_-]/g, '_');
  const recordType = String(formData.get('record_type') ?? 'photo').replace(/[^a-zA-Z0-9_-]/g, '_');
  const recordDate = String(formData.get('record_date') ?? new Date().toISOString().slice(0, 10));
  const ext = (file.name?.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const fileName = `${department}_${recordDate}_${recordType}-${Date.now()}.${ext}`;

  try {
    const accessToken = await getGoogleAccessToken(env);
    const fileId = await uploadFileToDrive(env, accessToken, file, fileName);
    await makeDriveFilePublic(accessToken, fileId);
    return okResponse(request, { url: `https://drive.google.com/uc?id=${fileId}`, file_id: fileId, name: fileName });
  } catch (err) {
    return errResponse(request, 'DRIVE_UPLOAD_ERROR', `Error al subir foto a Google Drive: ${err.message}`, 502);
  }
}

// ─── ROUTER PRINCIPAL ──────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') ?? '';

    // Preflight CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    const { pathname } = new URL(request.url);

    // Rutas públicas (sin JWT)
    if (pathname.startsWith('/api/auth/')) return handleAuth(request, env);

    // Todas las demás rutas requieren JWT válido
    const auth = await validateJWT(request, env);
    if (!auth.ok) return errResponse(request, 'UNAUTHORIZED', auth.message, 401);

    if (pathname.startsWith('/api/users'))       return handleUsers(request, env, auth);
    if (pathname.startsWith('/api/catalogs/'))   return handleCatalogs(request, env, auth);
    if (pathname.startsWith('/api/food/'))       return handleFood(request, env, auth);
    if (pathname.startsWith('/api/bio/'))        return handleBio(request, env, auth);
    if (pathname.startsWith('/api/nursery/'))    return handleNursery(request, env, auth);
    if (pathname.startsWith('/api/inventory/'))  return handleInventory(request, env, auth);
    if (pathname.startsWith('/api/tasks'))       return handleTasks(request, env, auth);
    if (pathname === '/api/farm-workers')        return handleFarmWorkers(request, env, auth);
    if (pathname.startsWith('/api/photos/'))     return handlePhotos(request, env, auth);

    return errResponse(request, 'NOT_FOUND', 'Ruta no encontrada', 404);
  },
};
