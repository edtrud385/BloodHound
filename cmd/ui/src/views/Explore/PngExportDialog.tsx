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

import {
    Checkbox,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControlLabel,
    TextField,
} from '@mui/material';
import { useNotifications } from 'bh-shared-ui';
import { Button } from 'doodle-ui';
import { useCallback, useEffect, useState } from 'react';
import {
    PngExportSettings,
    canPickFolder,
    canvasToPng,
    getPngExportSettings,
    getSavedFolder,
    pickFolder,
    previewName,
    savePng,
    setPngExportSettings,
} from './pngExport';

/**
 * Export > PNG (save now, using the settings) and Export > PNG options (folder, name, numbering).
 * `capture` returns the graph as it is on screen.
 */
export const usePngExport = (capture: () => HTMLCanvasElement | undefined) => {
    const { addNotification } = useNotifications();
    const [optionsOpen, setOptionsOpen] = useState(false);

    const save = useCallback(
        async (settings: PngExportSettings = getPngExportSettings()) => {
            try {
                const canvas = capture();
                if (!canvas || !canvas.width) return;
                const result = await savePng(await canvasToPng(canvas), settings);
                if (result.saved) {
                    const where = result.folder ? ` to ${result.folder}` : '';
                    addNotification(`Saved ${result.name}${where}`, 'PngExportSaved', { autoHideDuration: 3000 });
                }
            } catch (error) {
                console.error(error);
                addNotification('Could not save the PNG.', 'PngExportError');
            }
        },
        [capture, addNotification]
    );

    const dialog = (
        <PngExportDialog
            open={optionsOpen}
            onClose={() => setOptionsOpen(false)}
            onSave={(settings) => {
                setOptionsOpen(false);
                save(settings);
            }}
        />
    );

    return { save: () => save(), openOptions: () => setOptionsOpen(true), dialog };
};

type PngExportDialogProps = {
    open: boolean;
    onClose: () => void;
    onSave: (settings: PngExportSettings) => void;
};

const PngExportDialog = ({ open, onClose, onSave }: PngExportDialogProps) => {
    const [settings, setSettings] = useState<PngExportSettings>(getPngExportSettings);
    const [folderName, setFolderName] = useState<string>();
    const [nextName, setNextName] = useState('');
    const folderSupported = canPickFolder();

    useEffect(() => {
        if (!open) return;
        setSettings(getPngExportSettings());
        getSavedFolder().then((folder) => setFolderName(folder?.name));
    }, [open]);

    useEffect(() => {
        if (!open) return;
        let current = true;
        getSavedFolder()
            .then((folder) => previewName(settings, folder))
            .then((name) => current && setNextName(name));
        return () => {
            current = false;
        };
    }, [open, settings, folderName]);

    const update = (change: Partial<PngExportSettings>) => {
        const next = { ...settings, ...change };
        setSettings(next);
        setPngExportSettings(next);
    };

    const chooseFolder = async () => {
        const folder = await pickFolder();
        if (folder) setFolderName(folder.name);
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth='xs' fullWidth data-testid='png-export-dialog'>
            <DialogTitle>Save graph as PNG</DialogTitle>
            <DialogContent dividers className='flex flex-col gap-4'>
                {folderSupported ? (
                    <div className='flex items-center gap-2'>
                        <div className='flex-1 min-w-0'>
                            <div className='text-xs opacity-70'>Folder</div>
                            <div className='truncate' data-testid='png-export-folder'>
                                {folderName ?? 'None chosen yet'}
                            </div>
                        </div>
                        <Button variant='secondary' onClick={chooseFolder}>
                            {folderName ? 'Change…' : 'Choose…'}
                        </Button>
                    </div>
                ) : (
                    <p className='text-sm'>
                        This browser cannot save into a chosen folder, so the PNG goes to your Downloads folder. Use
                        Chrome or Edge to pick a folder.
                    </p>
                )}
                <TextField
                    label='File name'
                    size='small'
                    value={settings.prefix}
                    onChange={(event) => update({ prefix: event.target.value })}
                    inputProps={{ 'data-testid': 'png-export-prefix' }}
                />
                <FormControlLabel
                    control={
                        <Checkbox
                            checked={settings.autoNumber}
                            onChange={(event) => update({ autoNumber: event.target.checked })}
                            data-testid='png-export-autonumber'
                        />
                    }
                    label='Number the files automatically'
                />
                <div className='text-sm' data-testid='png-export-next-name'>
                    {settings.autoNumber ? (
                        <>
                            Next file: <b>{nextName}</b>
                        </>
                    ) : (
                        'You will be asked for a name each time.'
                    )}
                </div>
            </DialogContent>
            <DialogActions>
                <Button variant='secondary' onClick={onClose}>
                    Close
                </Button>
                <Button onClick={() => onSave(settings)} data-testid='png-export-save'>
                    Save PNG
                </Button>
            </DialogActions>
        </Dialog>
    );
};

