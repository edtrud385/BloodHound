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

import { Autocomplete, TextField } from '@mui/material';
import { useQuery } from 'react-query';
import { QueryPicker as QueryPickerType } from '../../../../types';
import { apiClient } from '../../../../utils';

/** Quote a picked name as a Cypher string literal. */
export const toCypherString = (value: string): string => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/** The picker's query with `$result` replaced by the chosen name. */
export const fillPickerQuery = (picker: QueryPickerType, value: string): string =>
    picker.query.split('$result').join(toCypherString(value));

/** Names of the nodes a picker offers, sorted. An empty result (CE answers 404) means no options. */
const fetchPickerOptions = async (optionsQuery: string): Promise<string[]> => {
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

type QueryPickerProps = {
    picker: QueryPickerType;
    value: string | null;
    /** Called with the chosen name, or null for "all" (the query as listed). */
    onChange: (value: string | null) => void;
};

/**
 * Legacy-style picker step: after a pre-built query runs for everything, choose one domain, group or role
 * to run it for just that one. Clearing the choice goes back to the run-everything query.
 */
const QueryPicker = ({ picker, value, onChange }: QueryPickerProps) => {
    const optionsQuery = useQuery(['prebuilt-query-picker', picker.options], () => fetchPickerOptions(picker.options), {
        staleTime: 60_000,
        refetchOnWindowFocus: false,
    });

    const options = optionsQuery.data ?? [];

    return (
        <div className='mt-2' data-testid='prebuilt-query-picker'>
            <Autocomplete
                size='small'
                options={options}
                value={value}
                loading={optionsQuery.isLoading}
                onChange={(_event, newValue) => onChange(newValue)}
                noOptionsText={optionsQuery.isError ? 'Could not load options' : 'Nothing to choose from'}
                renderInput={(params) => (
                    <TextField
                        {...params}
                        label={picker.title}
                        placeholder={`All (${options.length})`}
                        helperText={value ? undefined : 'Showing all. Pick one to narrow the query.'}
                    />
                )}
            />
        </div>
    );
};

export default QueryPicker;
