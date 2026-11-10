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

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { rest } from 'msw';
import { setupServer } from 'msw/node';
import { QueryClient, QueryClientProvider } from 'react-query';
import { vi } from 'vitest';
import QueryPickerDialog, { fillPickerQuery, toCypherString } from './QueryPicker';

const server = setupServer(
    rest.post('/api/v2/graphs/cypher', (req, res, ctx) =>
        res(
            ctx.json({
                data: {
                    nodes: {
                        '1': { label: 'PRIVILEGED ROLE ADMINISTRATOR@CORP', kind: 'AZRole' },
                        '2': { label: 'GLOBAL ADMINISTRATOR@CORP', kind: 'AZRole' },
                    },
                    edges: [],
                },
            })
        )
    )
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const picker = {
    title: 'Select a Privileged Role...',
    options: 'MATCH (n:AZRole) RETURN n',
    query: 'MATCH p=(s)-[:AZHasRole]->(t:AZRole)\nWHERE t.name = $result\nRETURN p',
};

describe('QueryPicker helpers', () => {
    it('quotes picked names as Cypher strings', () => {
        expect(toCypherString('CORP.LOCAL')).toBe("'CORP.LOCAL'");
        expect(toCypherString("O'BRIEN\\ADMINS")).toBe("'O\\'BRIEN\\\\ADMINS'");
    });

    it('replaces every $result in the picker query', () => {
        const picker = {
            title: 'Select a Domain...',
            options: 'MATCH (n:Domain) RETURN n',
            query: 'MATCH p=(c:Computer)-[:HasSession]->(u)\nWHERE c.domain = $result AND u.domain <> $result\nRETURN p',
        };
        expect(fillPickerQuery(picker, 'CORP.LOCAL')).toBe(
            "MATCH p=(c:Computer)-[:HasSession]->(u)\nWHERE c.domain = 'CORP.LOCAL' AND u.domain <> 'CORP.LOCAL'\nRETURN p"
        );
    });
});

describe('QueryPickerDialog', () => {
    it('lists the options and reports the one picked', async () => {
        const user = userEvent.setup();
        const onPick = vi.fn();
        render(
            <QueryClientProvider client={new QueryClient()}>
                <QueryPickerDialog picker={picker} onPick={onPick} onClose={vi.fn()} />
            </QueryClientProvider>
        );

        expect(screen.getByText('Select a Privileged Role...')).toBeInTheDocument();
        const options = await screen.findAllByRole('button', { name: /ADMINISTRATOR@CORP/ });
        expect(options.map((o) => o.textContent)).toEqual([
            'GLOBAL ADMINISTRATOR@CORP',
            'PRIVILEGED ROLE ADMINISTRATOR@CORP',
        ]);

        await user.click(screen.getByText('GLOBAL ADMINISTRATOR@CORP'));
        expect(onPick).toHaveBeenCalledWith('GLOBAL ADMINISTRATOR@CORP');

        await user.click(screen.getByRole('button', { name: 'Run for all (2)' }));
        expect(onPick).toHaveBeenLastCalledWith(null);
    });

    it('stays closed without a picker', () => {
        render(
            <QueryClientProvider client={new QueryClient()}>
                <QueryPickerDialog onPick={vi.fn()} onClose={vi.fn()} />
            </QueryClientProvider>
        );
        expect(screen.queryByTestId('prebuilt-query-picker')).toBeNull();
    });
});
