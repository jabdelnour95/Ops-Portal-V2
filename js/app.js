import { doLogin, logout, restoreSession,
         openPasswordModal, closePasswordModal, submitPasswordChange } from './modules/auth.js';
import { show, nav, openDept, openDeptFrom, openFinca, openOps, openFincaModule, navBackDept, filterCards, openResource, openCalendar } from './modules/navigation.js';
import { openInventarios, openRopaCama, openPropsMenu, openPropsForm, adjQty, submitInventario } from './modules/inventory.js';
import { openChecklistMenu, promptChecklist, closeModal, confirmChecklist, toggleCB, startChecklist, submitChecklist } from './modules/checklists.js';
import { openForm, submitForm }                          from './modules/forms.js';
import { toggleMic, stopRec }                           from './modules/audio.js';
import { handlePhotoUpload, removePhoto }               from './modules/photos.js';
import { openManualSection, renderManualLimp, renderManualManto } from './modules/manuals.js';
import { openReports, toggleAcc, viewReport }           from './modules/reports.js';
import { openFood, openFoodForm, submitFoodForm,
         addFoodInputRow, removeFoodInputRow,
         addFoodAvailRow, removeFoodAvailRow,
         addPrepBedRow, removePrepBedRow,
         addApplyBedRow, removeApplyBedRow,
         addMaintBedRow, removeMaintBedRow,
         addHarvestRow, removeHarvestRow,
         openPlantingTracking, openPlantingLotAction, openPlantingLotDetail, submitPlantingLotAction } from './modules/food.js';
import { openBio, openBioForm, submitBioForm,
         addBatchInputRow, removeBatchInputRow,
         openBioBatchPicker, openBioInventory } from './modules/bio.js';
import { openVivero, openNurseryForm, submitNurseryForm,
         addSubstrateRow, removeSubstrateRow,
         addQuoteRow, removeQuoteRow,
         openNurseryLotPicker, openNurseryQuoteForm, openNurseryQuotes,
         openNurseryInventory } from './modules/nursery.js';
import { openRecordsHome, openRecordsList, editRecord, deleteRecord } from './modules/records.js';
import { renderHomeTasks, openTaskCenter, openTaskCreateForm, submitTaskCreate, openTaskFromList, openTaskEditForm, submitTaskEdit, deleteAssignedTask } from './modules/tasks.js';

// Expose to HTML event handlers (onclick attributes) and cross-module calls
Object.assign(window, {
  doLogin, logout,
  openPasswordModal, closePasswordModal, submitPasswordChange,
  nav, openDept, openDeptFrom, openFinca, openOps, openFincaModule, navBackDept, filterCards, openResource,
  openInventarios, openRopaCama, openPropsMenu, openPropsForm, adjQty, submitInventario,
  openChecklistMenu, promptChecklist, closeModal, confirmChecklist, toggleCB, startChecklist, submitChecklist,
  openForm, submitForm,
  toggleMic, stopRec,
  handlePhotoUpload, removePhoto,
  openManualSection,
  openReports, toggleAcc, viewReport,
  // Food production module
  openFood, openFoodForm, submitFoodForm,
  addFoodInputRow, removeFoodInputRow,
  addFoodAvailRow, removeFoodAvailRow,
  addPrepBedRow, removePrepBedRow,
  addApplyBedRow, removeApplyBedRow,
  addMaintBedRow, removeMaintBedRow,
  addHarvestRow, removeHarvestRow,
  openPlantingTracking, openPlantingLotAction, openPlantingLotDetail, submitPlantingLotAction,
  // Biofactory module
  openBio, openBioForm, submitBioForm,
  addBatchInputRow, removeBatchInputRow,
  openBioBatchPicker, openBioInventory,
  // Nursery module
  openVivero, openNurseryForm, submitNurseryForm,
  addSubstrateRow, removeSubstrateRow,
  addQuoteRow, removeQuoteRow,
  openNurseryLotPicker, openNurseryQuoteForm, openNurseryQuotes,
  openNurseryInventory,
  // Records (admin: ver/editar/borrar registros de Finca)
  openRecordsHome, openRecordsList, editRecord, deleteRecord,
  // Tasks
  openTaskCenter, openTaskCreateForm, submitTaskCreate, openTaskFromList, openTaskEditForm, submitTaskEdit, deleteAssignedTask,
  _renderHomeTasks: renderHomeTasks,
  // Internal bindings used by navigation.js to avoid circular imports
  _openChecklistMenu: openChecklistMenu,
  _openInventarios:   openInventarios,
  _openProveedores:   () => {}, // placeholder for future module
  _renderManualLimp:  renderManualLimp,
  _renderManualManto: renderManualManto,
});

// Wire up non-inline event listeners
document.getElementById('lp').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

// Restore session if a valid token is stored locally
restoreSession();
