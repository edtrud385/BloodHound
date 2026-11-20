// Copyright 2023 Specter Ops, Inc.
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

import { MultiDirectedGraph } from 'graphology';
import {
    EDGE_LABEL_SIZE,
    getDeclutteredLabels,
    getLabelScale,
    getLabelSizeMultiplier,
    getNodeHitRadius,
    NODE_HIT_MARGIN_PX,
    NODE_LABEL_SIZE,
    setLabelSizeMultiplier,
    shortenNodeLabel,
} from './legacyView';

describe('shortenNodeLabel', () => {
    it('keeps labels up to 40 characters as they are', () => {
        expect(shortenNodeLabel('DC01.CORP.LOCAL')).toBe('DC01.CORP.LOCAL');
        expect(shortenNodeLabel('DOMAIN CONTROLLERS@EXAMPLE.ORG')).toBe('DOMAIN CONTROLLERS@EXAMPLE.ORG');
    });

    it('never cuts the name before @, only the domain', () => {
        expect(shortenNodeLabel('ADMINISTRATOR@EXAMPLE.ORG', 20)).toBe('ADMINISTRATOR@EXAMPL…');
        expect(shortenNodeLabel('SVC_SQLREPORTING01@CORP.EXAMPLE.COM', 20)).toBe('SVC_SQLREPORTING01@…');
        expect(shortenNodeLabel('SVC_SQLREPORTING_PRODUCTION@SUBSIDIARY.CORP.EXAMPLE.COM')).toBe(
            'SVC_SQLREPORTING_PRODUCTION@SUBSIDIARY.C…'
        );
    });

    it('never cuts a computer name before the first dot', () => {
        expect(shortenNodeLabel('ACME-HQ-WORKSTATION-03.EXAMPLE.ORG', 20)).toBe('ACME-HQ-WORKSTATION-03.…');
        expect(shortenNodeLabel('APP-WEB-SRV01.EXAMPLE.ORG', 20)).toBe('APP-WEB-SRV01.EXAMPL…');
    });

    it('never shortens labels with a SID', () => {
        const sid = 'S-1-5-21-1111111111-2222222222-3333333333-1105';
        expect(shortenNodeLabel(sid)).toBe(sid);
        expect(shortenNodeLabel('EXAMPLE.ORG-S-1-5-32-544')).toBe('EXAMPLE.ORG-S-1-5-32-544');
    });

    it('keeps labels without a domain whole', () => {
        expect(shortenNodeLabel('ENTERPRISE KEY ADMINS AND OPERATORS')).toBe('ENTERPRISE KEY ADMINS AND OPERATORS');
    });
});

describe('label sizes', () => {
    afterEach(() => {
        setLabelSizeMultiplier('node', 1);
        setLabelSizeMultiplier('edge', 1);
    });

    it('draws edge labels at 16/22 of the node label size, like Legacy', () => {
        expect(EDGE_LABEL_SIZE / NODE_LABEL_SIZE).toBeCloseTo(16 / 22);
        expect(EDGE_LABEL_SIZE * getLabelScale(1, 'edge')).toBeCloseTo(
            (NODE_LABEL_SIZE * getLabelScale(1, 'node') * 16) / 22
        );
    });

    it('sizes node and edge labels independently', () => {
        const edgeBefore = getLabelScale(1, 'edge');
        setLabelSizeMultiplier('node', 1.5);
        expect(getLabelSizeMultiplier('node')).toBe(1.5);
        expect(getLabelScale(1, 'node')).toBeCloseTo(1.5 * getLabelScale(1, 'edge'));
        expect(getLabelScale(1, 'edge')).toBe(edgeBefore);
    });

    it('remembers each size under its own key', () => {
        const stored = new Map<string, string>();
        const setItem = vi.fn((key: string, value: string) => stored.set(key, value));
        vi.stubGlobal('localStorage', { getItem: (key: string) => stored.get(key) ?? null, setItem });
        try {
            setLabelSizeMultiplier('edge', 2);
            expect(stored.get('bh-legacy-view-edge-label-size')).toBe('2');
            expect(stored.has('bh-legacy-view-label-size')).toBe(false);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('clamps to the allowed range', () => {
        expect(setLabelSizeMultiplier('edge', 100)).toBe(2.5);
        expect(setLabelSizeMultiplier('edge', 0.01)).toBe(0.6);
    });
});

describe('graph background', () => {
    it('tints a white light-mode canvas and leaves dark mode alone', async () => {
        const { getGraphBackgroundColor, LIGHT_GRAPH_BACKGROUND } = await import('./legacyView');
        expect(getGraphBackgroundColor('#FFFFFF')).toBe(LIGHT_GRAPH_BACKGROUND);
        expect(getGraphBackgroundColor(' #fff ')).toBe(LIGHT_GRAPH_BACKGROUND);
        expect(getGraphBackgroundColor('rgb(255, 255, 255)')).toBe(LIGHT_GRAPH_BACKGROUND);
        expect(getGraphBackgroundColor('#121212')).toBe('#121212');
    });
});

describe('getNodeHitRadius', () => {
    it('matches the drawn circle (plus a small margin) instead of growing with zoom-out', () => {
        // Sigma passes size / sqrt(ratio); the circle is drawn at about size / ratio
        const size = 30;
        for (const ratio of [1, 4, 25, 100]) {
            const drawn = (2 * size) / ratio / 2.1;
            expect(getNodeHitRadius(size / Math.sqrt(ratio), ratio)).toBeCloseTo(drawn + NODE_HIT_MARGIN_PX);
        }
        // At ratio 25 sigma's own circle would be 5x the icon
        expect(getNodeHitRadius(30 / 5, 25)).toBeLessThan(30 / 5 / 1.5);
    });
});

describe('getDeclutteredLabels', () => {
    const build = (positions: [string, number, number][]) => {
        const graph = new MultiDirectedGraph();
        positions.forEach(([id, x, y]) => graph.addNode(id, { x, y, label: `${id}@CONTOSO.LOCAL` }));
        return graph;
    };

    it('keeps every label that has room on screen, however large the graph coordinates are', () => {
        // A column of users 80px apart on screen, in graph units 1000x larger (a big graph seen up close)
        const graph = build([0, 1, 2, 3, 4, 5].map((i): [string, number, number] => [`USER${i}`, 0, i * 80000]));
        const labels = getDeclutteredLabels(graph, 4, ({ x, y }) => ({ x: x / 1000, y: y / 1000 }));
        expect(labels.size).toBe(6);
    });

    it('drops a label only where it would land on top of another one', () => {
        const graph = build([
            ['A', 0, 0],
            ['B', 3, 4],
            ['C', 0, 200],
        ]);
        graph.addEdge('A', 'C');
        const labels = getDeclutteredLabels(graph, 4, (p) => p);
        expect(labels.has('A')).toBe(true); // most connected wins the clash
        expect(labels.has('B')).toBe(false);
        expect(labels.has('C')).toBe(true);
    });
});

describe('getDeclutteredLabels on screen', () => {
    const view = (extra = {}) => ({ width: 1000, height: 800, key: 'v', ...extra });

    it('gives the name to a Tier Zero node when labels collide', () => {
        const graph = new MultiDirectedGraph();
        graph.addNode('USER', { x: 100, y: 300, label: 'SOME USER WITH A LONG NAME@CONTOSO.LOCAL' });
        graph.addNode('T0', { x: 160, y: 302, label: 'SCHEMA ADMINS@CONTOSO.LOCAL', glyphs: [{}] });
        ['a', 'b', 'c'].forEach((n) => {
            graph.addNode(n, { x: 900, y: 700 + n.charCodeAt(0), label: n });
            graph.addEdge('USER', n);
        });
        const labels = getDeclutteredLabels(graph, 4, (p) => p, view({ key: 't0' }));
        expect(labels.has('T0')).toBe(true);
        expect(labels.has('USER')).toBe(false);
    });

    it('ignores nodes the graph hides', () => {
        const graph = new MultiDirectedGraph();
        graph.addNode('HIDDEN', { x: 100, y: 100, label: 'HIDDEN@CONTOSO.LOCAL' });
        graph.addNode('SHOWN', { x: 102, y: 102, label: 'SHOWN@CONTOSO.LOCAL' });
        graph.addEdge('HIDDEN', 'SHOWN');
        graph.addNode('x', { x: 900, y: 700, label: 'x' });
        graph.addEdge('HIDDEN', 'x');
        const labels = getDeclutteredLabels(
            graph,
            4,
            (p) => p,
            view({ key: 'hid', isHidden: (n: string) => n === 'HIDDEN', hiddenKey: '1' })
        );
        expect(labels.has('SHOWN')).toBe(true);
        expect(labels.has('HIDDEN')).toBe(false);
    });
});
