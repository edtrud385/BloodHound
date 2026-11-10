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
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    List,
    ListItemButton,
    ListItemText,
} from '@mui/material';
import { Button } from 'doodle-ui';
import { useQuery } from 'react-query';
import { QueryPicker as QueryPickerType } from '../../../../types';
import { apiClient } from '../../../../utils';

/** Quote a picked name as a Cypher string literal. */
export const toCypherString = (value: string): string => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/** The picker's query with `$result` replaced by the chosen name. */
export const fillPickerQuery = (picker: QueryPickerType, value: string): string =>
    picker.query.split('$result').join(toCypherString(value));

/** Names of the nodes a picker offers, sorted. An empty result (CE answers 404) means no options. */
export const fetchPickerOptions = async (optionsQuery: string): Promise<string[]> => {
    try {
        const response = await apiClient.cypherSearch(optionsQuery);
        const nodes = Object.values(response.data?.data?.nodes ?? {});
        const names = nodes.map((node) => node.label).filter((label): label is string => !!label);
        return [...new Set(names)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    } catch (error: any) {
        if (error?.response?.status === 404) return [];
        throw error;
    }
};

export const pickerOptionsQueryKey = (optionsQuery?: string) => ['prebuilt-query-picker', optionsQuery];

type QueryPickerDialogProps = {
    /** The picker of the clicked query; the dialog is open while this is set. */
    picker?: QueryPickerType;
    /** Called with the chosen name, or null for "All" (the query as listed). */
    onPick: (value: string | null) => void;
    onClose: () => void;
};

/**
 * Legacy-style picker step: clicking a pre-built query that has one first asks which domain, group or
 * role to run it for, then runs it for that one (or for all of them).
 */
const QueryPickerDialog = ({ picker, onPick, onClose }: QueryPickerDialogProps) => {
    const optionsQuery = useQuery(pickerOptionsQueryKey(picker?.options), () => fetchPickerOptions(picker!.options), {
        enabled: !!picker,
        staleTime: 60_000,
        refetchOnWindowFocus: false,
    });
    const options = optionsQuery.data ?? [];

    return (
        <Dialog open={!!picker} onClose={onClose} maxWidth='sm' fullWidth data-testid='prebuilt-query-picker'>
            <DialogTitle>{picker?.title}</DialogTitle>
            <DialogContent dividers className='p-0'>
                {optionsQuery.isLoading ? (
                    <div className='flex justify-center p-6'>
                        <CircularProgress size={28} />
                    </div>
                ) : optionsQuery.isError ? (
                    <p className='p-4'>Could not load the options. Try again, or run it for all.</p>
                ) : (
                    <List dense disablePadding>
                        {options.map((option) => (
                            <ListItemButton key={option} divider onClick={() => onPick(option)}>
                                <ListItemText primary={option} />
                            </ListItemButton>
                        ))}
                        {options.length === 0 && <p className='p-4'>Nothing to choose from in this database.</p>}
                    </List>
                )}
            </DialogContent>
            <DialogActions>
                <Button variant='secondary' onClick={onClose}>
                    Cancel
                </Button>
                <Button variant='secondary' onClick={() => onPick(null)}>
                    Run for all{options.length ? ` (${options.length})` : ''}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default QueryPickerDialog;
