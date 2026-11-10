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

import { truncateText } from 'bh-shared-ui';
import { Settings } from 'sigma/settings';
import { NODE_LABEL_BACKGROUND, SHOW_NODE_SUBLABELS } from '../legacyView';
import {
    EDGE_MIDDLE_ALIGN_OFFSET,
    EDGE_TYPES,
    GraphItemData,
    LABEL_PADDING,
    LabelBoundsParams,
    calculateLabelOpacity,
    getLabelBoundsFromContext,
    getNodeLabelBoundsBelowFromContext,
} from '../utils/utils';

const SUBLABEL_FONT_RATIO = 0.85;

export default function drawLabel(context: CanvasRenderingContext2D, data: GraphItemData, settings: Settings): void {
    if (!data.label || !settings.labelColor.color) return;

    const inverseSqrtZoomRatio = data.inverseSqrtZoomRatio || 1;
    // Legacy view: font size and opacity use a floored scale so labels stay readable when zoomed out;
    // label placement still uses the true zoom so labels stay attached to their node.
    const labelScale = data.labelScale ?? inverseSqrtZoomRatio;

    const size = settings.labelSize * labelScale,
        font = settings.labelFont,
        weight = settings.labelWeight;

    const fillBackground = data.highlighted ? data.highlightedBackground : data.backgroundColor;
    const fillText = data.highlighted ? data.highlightedText : settings.labelColor.color;

    const dimFactor = data.isDimmed ? data.labelDimFactor ?? 0.1 : 1;
    context.globalAlpha = calculateLabelOpacity(labelScale) * dimFactor;

    // Edge labels: use original right-of-node positioning with center-alignment offset
    if (EDGE_TYPES.includes(data.type ?? '')) {
        context.font = `${weight} ${size}px ${font}`;

        const labelParams: LabelBoundsParams = {
            inverseSqrtZoomRatio,
            label: data.label,
            position: data,
            size: data.size ?? 0,
        };

        const labelbounds = getLabelBoundsFromContext(context, labelParams);
        labelbounds[0] = labelbounds[0] - labelbounds[2] / 2 - EDGE_MIDDLE_ALIGN_OFFSET;

        // Draw background at full opacity so it always masks the edge line behind it
        context.globalAlpha = 1;
        context.fillStyle = fillBackground;
        context.fillRect(...labelbounds);

        // Draw text with zoom/dim factor applied
        context.globalAlpha = calculateLabelOpacity(labelScale) * dimFactor;
        context.fillStyle = fillText;
        context.fillText(data.label, labelbounds[0] + LABEL_PADDING, labelbounds[1] + labelbounds[3] - LABEL_PADDING);

        context.globalAlpha = 1;
        return;
    }

    // Node labels: truncated primary label + truncated sublabel, centered below the node
    // When the node is highlighted (selected), show the full label instead of truncating

    const labelTextRendered = (labelText: string) => {
        if (data.isExploreGraphLabelClip === false) return labelText;
        return data.highlighted ? labelText : truncateText(labelText) ?? labelText;
    };

    const primaryLabel = labelTextRendered(data.label);
    // Without a background box, a selected node's label is shown in the highlight color instead
    const nodeLabelColor = NODE_LABEL_BACKGROUND
        ? fillText
        : data.highlighted
          ? data.highlightedBackground ?? fillText
          : settings.labelColor.color;
    const nodeSize = data.size ?? 0;

    context.font = `bold ${size}px ${font}`;

    const primaryParams: LabelBoundsParams = {
        inverseSqrtZoomRatio,
        label: primaryLabel,
        position: data,
        size: nodeSize,
    };

    const primaryBounds = getNodeLabelBoundsBelowFromContext(context, primaryParams);

    // Legacy view: no background box behind node labels (see NODE_LABEL_BACKGROUND)
    if (NODE_LABEL_BACKGROUND) {
        context.globalAlpha = 1;
        context.fillStyle = fillBackground;
        context.fillRect(...primaryBounds);
    }

    context.globalAlpha = calculateLabelOpacity(labelScale) * dimFactor;
    context.fillStyle = nodeLabelColor;
    context.fillText(
        primaryLabel,
        primaryBounds[0] + LABEL_PADDING,
        primaryBounds[1] + primaryBounds[3] - LABEL_PADDING
    );

    // Legacy view: single-line labels; the "source | kind" sublabel is off (see SHOW_NODE_SUBLABELS)
    if (SHOW_NODE_SUBLABELS && data.source && data.kind) {
        const nodeSource = labelTextRendered(data.source);
        const nodeKind = labelTextRendered(data.kind);
        const sublabelText = `${nodeSource} | ${nodeKind}`;
        const sublabelSize = size * SUBLABEL_FONT_RATIO;
        context.font = `${weight} ${sublabelSize}px ${font}`;

        const sublabelParams: LabelBoundsParams = {
            inverseSqrtZoomRatio,
            label: sublabelText,
            position: data,
            size: nodeSize,
        };

        const sublabelBounds = getNodeLabelBoundsBelowFromContext(context, sublabelParams, primaryBounds[3]);

        if (NODE_LABEL_BACKGROUND) {
            context.globalAlpha = 1;
            context.fillStyle = fillBackground;
            context.fillRect(...sublabelBounds);
        }

        context.globalAlpha = calculateLabelOpacity(labelScale) * dimFactor;
        context.fillStyle = nodeLabelColor;
        context.fillText(
            sublabelText,
            sublabelBounds[0] + LABEL_PADDING,
            sublabelBounds[1] + sublabelBounds[3] - LABEL_PADDING
        );
    }

    context.globalAlpha = 1;
}
