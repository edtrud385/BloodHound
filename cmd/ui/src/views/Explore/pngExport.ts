// Copyright 2026 Specter Ops, Inc.
//
// Licensed under the Apache License, Version 2.0
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

/*
 * Export > PNG: save the graph as a PNG into a folder the user picked once, optionally numbered
 * (bloodhound-001.png, bloodhound-002.png, ...). Uses the File System Access API (Chrome / Edge); where
 * the browser has none it falls back to an ordinary download with the same name.
 */

type DirectoryHandle = any;

export type PngExportSettings = {
    /** File name before the number (or the whole name when not numbering). */
    prefix: string;
    autoNumber: boolean;
};

const SETTINGS_KEY = 'bh-png-export';
const DEFAULT_SETTINGS: PngExportSettings = { prefix: 'bloodhound', autoNumber: true };
const FALLBACK_COUNTER_KEY = 'bh-png-export-counter';

export const canPickFolder = (): boolean => typeof (window as any).showDirectoryPicker === 'function';

export const getPngExportSettings = (): PngExportSettings => {
    try {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
    } catch {
        return DEFAULT_SETTINGS;
    }
};

export const setPngExportSettings = (settings: PngExportSettings) => {
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
        // Not saved: the defaults are used next time
    }
};

/** A file name without characters Windows/macOS reject. */
export const cleanPrefix = (prefix: string): string =>
    prefix
        .replace(/\.png$/i, '')
        .replace(/[\\/:*?"<>|]+/g, '-')
        .trim() || DEFAULT_SETTINGS.prefix;

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The next free number for `prefix` among the given file names: one past the highest used. */
export const nextNumber = (fileNames: Iterable<string>, prefix: string): number => {
    const pattern = new RegExp(`^${escapeRegExp(prefix)}-(\\d+)\\.png$`, 'i');
    let highest = 0;
    for (const name of fileNames) {
        const match = pattern.exec(name);
        if (match) highest = Math.max(highest, Number(match[1]));
    }
    return highest + 1;
};

export const numberedName = (prefix: string, n: number) => `${prefix}-${String(n).padStart(3, '0')}.png`;

// --- The chosen folder, kept across reloads (a folder handle can only be stored in IndexedDB) ---

const DB_NAME = 'bh-png-export';
const STORE = 'handles';
const FOLDER_KEY = 'folder';

const withStore = <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> =>
    new Promise((resolve, reject) => {
        const open = indexedDB.open(DB_NAME, 1);
        open.onupgradeneeded = () => open.result.createObjectStore(STORE);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
            const request = run(open.result.transaction(STORE, mode).objectStore(STORE));
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        };
    });

export const getSavedFolder = async (): Promise<DirectoryHandle | undefined> => {
    try {
        return await withStore('readonly', (store) => store.get(FOLDER_KEY));
    } catch {
        return undefined;
    }
};

/** Ask for a folder; resolves undefined if the user cancels. */
export const pickFolder = async (): Promise<DirectoryHandle | undefined> => {
    try {
        const current = await getSavedFolder();
        const folder = await (window as any).showDirectoryPicker({
            id: 'bh-png-export',
            mode: 'readwrite',
            ...(current ? { startIn: current } : {}),
        });
        await withStore('readwrite', (store) => store.put(folder, FOLDER_KEY));
        return folder;
    } catch (error: any) {
        if (error?.name === 'AbortError') return undefined;
        throw error;
    }
};

/** Browsers forget write access between sessions; ask again (needs the click that started the save). */
const ensureWritable = async (folder: DirectoryHandle): Promise<boolean> => {
    const options = { mode: 'readwrite' };
    if ((await folder.queryPermission?.(options)) === 'granted') return true;
    return (await folder.requestPermission?.(options)) === 'granted';
};

const listNames = async (folder: DirectoryHandle): Promise<string[]> => {
    const names: string[] = [];
    for await (const name of folder.keys()) names.push(name);
    return names;
};

/** The name the next save will get in `folder`, for the dialog's preview. */
export const previewName = async (settings: PngExportSettings, folder?: DirectoryHandle): Promise<string> => {
    const prefix = cleanPrefix(settings.prefix);
    if (!settings.autoNumber) return `${prefix}.png`;
    if (!folder) return numberedName(prefix, Number(localStorage.getItem(FALLBACK_COUNTER_KEY) ?? 0) + 1);
    try {
        if ((await folder.queryPermission?.({ mode: 'readwrite' })) !== 'granted') return numberedName(prefix, 1);
        return numberedName(prefix, nextNumber(await listNames(folder), prefix));
    } catch {
        return numberedName(prefix, 1);
    }
};

const download = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export type SaveResult = { saved: false } | { saved: true; name: string; folder?: string };

/**
 * Save the PNG. Numbered: straight into the folder as the next free number. Not numbered: a Save As
 * dialog that opens in the folder. No folder API: a normal download.
 */
export const savePng = async (blob: Blob, settings: PngExportSettings): Promise<SaveResult> => {
    const prefix = cleanPrefix(settings.prefix);

    if (!canPickFolder()) {
        let name = `${prefix}.png`;
        if (settings.autoNumber) {
            const n = Number(localStorage.getItem(FALLBACK_COUNTER_KEY) ?? 0) + 1;
            localStorage.setItem(FALLBACK_COUNTER_KEY, String(n));
            name = numberedName(prefix, n);
        }
        download(blob, name);
        return { saved: true, name };
    }

    const folder = (await getSavedFolder()) ?? (await pickFolder());
    if (!folder) return { saved: false };

    if (!settings.autoNumber) {
        try {
            const file = await (window as any).showSaveFilePicker({
                startIn: folder,
                suggestedName: `${prefix}.png`,
                types: [{ description: 'PNG image', accept: { 'image/png': ['.png'] } }],
            });
            const writable = await file.createWritable();
            await writable.write(blob);
            await writable.close();
            return { saved: true, name: file.name };
        } catch (error: any) {
            if (error?.name === 'AbortError') return { saved: false };
            throw error;
        }
    }

    if (!(await ensureWritable(folder))) return { saved: false };
    const names = await listNames(folder);
    const name = numberedName(prefix, nextNumber(names, prefix));
    const file = await folder.getFileHandle(name, { create: true });
    const writable = await file.createWritable();
    await writable.write(blob);
    await writable.close();
    return { saved: true, name, folder: folder.name };
};

export const canvasToPng = (canvas: HTMLCanvasElement): Promise<Blob> =>
    new Promise((resolve, reject) =>
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not create the PNG'))), 'image/png')
    );
