import { store } from './store.js';
import { showToast } from './ui-render.js';
import { socket } from './socket-client.js';
import './save-parser.js';

const parser = window.HomeAuctionSaveParser;
const modal = document.getElementById('saves-modal');
const openButton = document.getElementById('open-saves-btn');
const closeButton = document.getElementById('saves-close-btn');
const chooseFolderButton = document.getElementById('saves-choose-folder');
const folderName = document.getElementById('saves-folder-name');
const fileList = document.getElementById('saves-file-list');
const saveForm = document.getElementById('saves-save-form');
const saveName = document.getElementById('saves-file-name');
const saveButton = document.getElementById('saves-save-btn');
const status = document.getElementById('saves-status');
const helpToggle = document.getElementById('saves-help-toggle');
const helpBox = document.getElementById('saves-help-box');
const copyTemplateButton = document.getElementById('saves-copy-template');
const template = document.getElementById('saves-template');
const fallbackLoader = document.getElementById('saves-fallback-loader');
const fileInput = document.getElementById('saves-file-input');
const joinLoadButton = document.getElementById('join-load-save-btn');
const joinFileInput = document.getElementById('join-save-file');
const joinIndicator = document.getElementById('join-save-indicator');
const clearInitialSaveButton = document.getElementById('clear-initial-save-btn');

let directoryHandle = null;
let pendingInitialItems = null;
let filesInFolder = [];
const canPickDirectory = typeof window.showDirectoryPicker === 'function';

function isBeforeJoin() {
  return !store.appState || !store.appState.me;
}

function setStatus(message) {
  status.textContent = message;
}

function updateFolderName() {
  folderName.textContent = directoryHandle ? `Текущая папка: ${directoryHandle.name}` : 'Папка не выбрана';
}

function updateSaveControls() {
  const state = store.appState;
  saveButton.disabled = !state || !state.me;
  fileList.querySelectorAll('.saves-load-file').forEach(button => {
    button.disabled = Boolean(state && state.me && (state.phase !== 'POOL' || state.me.isSpectator));
  });
}

document.addEventListener('auction:state-update', updateSaveControls);

function showMessage(container, message) {
  container.replaceChildren();
  const paragraph = document.createElement('p');
  paragraph.className = 'muted-text small-text';
  paragraph.textContent = message;
  container.append(paragraph);
}

async function chooseDirectory() {
  if (!canPickDirectory) {
    fallbackLoader.classList.remove('hidden');
    setStatus('Этот браузер не поддерживает выбор папки. Выберите файл для загрузки или сохраните его скачиванием.');
    return false;
  }
  try {
    directoryHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    updateFolderName();
    await scanDirectory();
    return true;
  } catch (error) {
    if (error && error.name === 'AbortError') return false;
    setStatus(`Не удалось открыть папку: ${error.message}`);
    showToast(`Не удалось открыть папку: ${error.message}`);
    return false;
  }
}

async function scanDirectory() {
  if (!directoryHandle) return;
  filesInFolder = [];
  showMessage(fileList, 'Сканирование папки…');
  try {
    for await (const [name, handle] of directoryHandle.entries()) {
      if (handle.kind !== 'file' || !/\.(?:md|txt)$/i.test(name)) continue;
      const file = await handle.getFile();
      try {
        const parsed = parser.parseSaveFile(await file.text());
        filesInFolder.push({ name, handle, parsed });
      } catch {
        continue;
      }
    }
    renderFileList();
  } catch (error) {
    setStatus(`Не удалось прочитать папку: ${error.message}`);
    showToast(`Не удалось прочитать папку: ${error.message}`);
    showMessage(fileList, 'Не удалось прочитать содержимое папки.');
  }
}

function renderFileList() {
  fileList.replaceChildren();
  if (filesInFolder.length === 0) {
    showMessage(fileList, 'Подходящие файлы сохранений не найдены. Выберите папку с сохранениями, чтобы увидеть список файлов.');
    return;
  }
  for (const entry of filesInFolder) {
    const row = document.createElement('div');
    row.className = 'saves-file-row';
    const details = document.createElement('div');
    details.className = 'saves-file-details';
    const name = document.createElement('strong');
    name.textContent = entry.name;
    const count = document.createElement('span');
    count.className = 'muted-text small-text';
    count.textContent = `${entry.parsed.items.length} вариантов`;
    details.append(name, count);
    const load = document.createElement('button');
    load.type = 'button';
    load.className = 'btn btn-outline btn-sm saves-load-file';
    load.textContent = 'Загрузить';
    load.addEventListener('click', () => loadParsedSave(entry.parsed, entry.name));
    row.append(details, load);
    fileList.append(row);
  }
  updateSaveControls();
}

function showSelectedJoinSave(parsed, name) {
  pendingInitialItems = parsed.items;
  joinIndicator.textContent = `Загружен: ${name} (${parsed.items.length} лотов)`;
  joinIndicator.classList.remove('hidden');
  clearInitialSaveButton.classList.remove('hidden');
}

function clearInitialSave() {
  pendingInitialItems = null;
  joinFileInput.value = '';
  joinIndicator.textContent = '';
  joinIndicator.classList.add('hidden');
  clearInitialSaveButton.classList.add('hidden');
}

function loadParsedSave(parsed, name) {
  if (isBeforeJoin()) {
    showSelectedJoinSave(parsed, name);
    setStatus(`Выбрано стартовое сохранение: ${name}. Оно будет загружено при входе первого игрока.`);
    return;
  }
  if (store.appState.phase !== 'POOL') {
    showToast('Загружать варианты можно только в фазе пула.');
    return;
  }
  if (store.appState.me.isSpectator) {
    showToast('Зритель не может загружать варианты в пул.');
    return;
  }
  socket.emit('import_pool_items', { items: parsed.items });
}

async function parseFileInput(input) {
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  try {
    const parsed = parser.parseSaveFile(await file.text());
    if (input === joinFileInput || isBeforeJoin()) {
      showSelectedJoinSave(parsed, file.name);
      setStatus(`Загружено стартовое сохранение: ${file.name} (${parsed.items.length} лотов).`);
    } else {
      loadParsedSave(parsed, file.name);
    }
  } catch (error) {
    showToast(error.message);
    if (input === joinFileInput) joinIndicator.textContent = 'Сохранение не выбрано';
  }
}

function getItemsForSave() {
  const state = store.appState;
  if (!state || !state.me) throw new Error('Войдите в комнату, чтобы сохранить игру.');
  const allItems = state.allItems || [];
  if (state.phase === 'POOL') {
    return allItems
      .filter(item => item.isOwn && !item.isSystem)
      .map(item => ({ title: item.title, points: item.myPoints || 0, isFreeSlot: Boolean(item.isFreeSlot) }));
  }
  return allItems
    .filter(item => !item.isMerged)
    .map(item => ({ title: item.title, points: item.totalPoints || 0, isFreeSlot: Boolean(item.isFreeSlot) }));
}

function safeFileName(value) {
  const trimmed = value.trim().replace(/\.md$/i, '');
  const clean = trimmed.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '');
  if (!clean) throw new Error('Введите корректное название файла.');
  return `${clean}.md`;
}

async function saveCurrentGame() {
  try {
    if (!directoryHandle && canPickDirectory) {
      const selected = await chooseDirectory();
      if (!selected) return;
    }
    const filename = safeFileName(saveName.value);
    const contents = parser.serializeSaveFile(getItemsForSave());
    if (directoryHandle) {
      const permission = await directoryHandle.queryPermission({ mode: 'readwrite' });
      if (permission !== 'granted' &&
          await directoryHandle.requestPermission({ mode: 'readwrite' }) !== 'granted') {
        throw new Error('Нет разрешения на запись в выбранную папку.');
      }
      const handle = await directoryHandle.getFileHandle(filename, { create: true });
      const writable = await handle.createWritable();
      await writable.write(contents);
      await writable.close();
      setStatus(`Сохранено: ${filename}`);
      await scanDirectory();
      return;
    }
    const blob = new Blob([contents], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    setStatus(`Файл ${filename} скачан.`);
  } catch (error) {
    setStatus(error.message);
    showToast(error.message);
  }
}

function openModal() {
  modal.classList.remove('hidden');
  if (!canPickDirectory) fallbackLoader.classList.remove('hidden');
  if (directoryHandle) scanDirectory();
  else showMessage(fileList, 'Выберите папку с сохранениями, чтобы увидеть список файлов.');
  updateSaveControls();
}

function closeModal() {
  modal.classList.add('hidden');
}

export function getInitialItems() {
  return pendingInitialItems;
}

export function onSavesStateUpdate() {
  updateSaveControls();
}

openButton.addEventListener('click', openModal);
closeButton.addEventListener('click', closeModal);
chooseFolderButton.addEventListener('click', chooseDirectory);
modal.addEventListener('click', event => {
  if (event.target === modal) closeModal();
});
helpToggle.addEventListener('click', () => {
  const expanded = helpToggle.getAttribute('aria-expanded') === 'true';
  helpToggle.setAttribute('aria-expanded', String(!expanded));
  helpBox.setAttribute('aria-hidden', String(expanded));
  helpBox.classList.toggle('is-open', !expanded);
});
copyTemplateButton.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(template.textContent);
    showToast('Шаблон скопирован.');
  } catch (error) {
    showToast(`Не удалось скопировать шаблон: ${error.message}`);
  }
});
saveForm.addEventListener('submit', event => {
  event.preventDefault();
  saveCurrentGame();
});
fileInput.addEventListener('change', () => parseFileInput(fileInput));
joinLoadButton.addEventListener('click', () => joinFileInput.click());
joinFileInput.addEventListener('change', () => parseFileInput(joinFileInput));
clearInitialSaveButton.addEventListener('click', clearInitialSave);
document.addEventListener('auction:initial-save-unavailable', clearInitialSave);
socket.on('pool_import_result', result => {
  showToast(`Добавлено ${result.added} вариантов (пропущено дубликатов: ${result.duplicates}, не хватило слотов: ${result.noSlots})`);
});

const today = new Date();
saveName.value = `auction-save-${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
updateFolderName();
updateSaveControls();
