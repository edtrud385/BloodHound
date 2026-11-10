// Copyright 2025 Specter Ops, Inc.
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
import { RelationshipDetailsWithInfo } from 'js-client-library';
import { useQuery } from 'react-query';
import { SNACKBAR_DURATION_LONG } from '../../constants';
import { useNotifications } from '../../providers';
import { getQueryHiddenEdgeKinds, useEdgeFilter } from '../../utils/edgeViewFilter';
import { useTimeoutLimitConfiguration } from '../useConfiguration';
import { ExploreQueryParams, useExploreParams } from '../useExploreParams';
import { isRelationshipResponse, useGraphItem } from '../useGraphItem';
import {
    ExploreGraphQuery,
    ExploreGraphQueryOptions,
    aclInheritanceSearchQuery,
    compositionSearchQuery,
    cypherSearchQuery,
    fallbackQuery,
    nodeSearchQuery,
    pathfindingSearchQuery,
    relationshipSearchQuery,
} from './queries';

export function exploreGraphQueryFactory(
    paramOptions: Partial<ExploreQueryParams>,
    {
        userSettings,
        relationshipDetails,
        queryHiddenEdgeKinds = [],
    }: {
        userSettings: UserSettings;
        relationshipDetails?: RelationshipDetailsWithInfo;
        queryHiddenEdgeKinds?: string[];
    }
): ExploreGraphQuery {
    switch (paramOptions.searchType) {
        case 'node':
            return nodeSearchQuery(paramOptions);
        case 'pathfinding':
            return pathfindingSearchQuery(paramOptions);
        case 'relationship':
            return relationshipSearchQuery(paramOptions);
        case 'composition':
            return compositionSearchQuery(paramOptions, relationshipDetails);
        case 'cypher':
            return cypherSearchQuery(paramOptions, userSettings, queryHiddenEdgeKinds);
        case 'aclinheritance':
            return aclInheritanceSearchQuery(paramOptions, relationshipDetails);
        default:
            return fallbackQuery;
    }
}

// Hook for maintaining the top level graph query powering the explore page
export const useExploreGraph = (options: ExploreGraphQueryOptions = {}) => {
    const params = useExploreParams();
    const { onError, ...rest } = options;

    const { addNotification } = useNotifications();
    const userSettings = useUserSettings();

    const { data } = useGraphItem(params.relationshipQueryItemId);
    const relationshipDetails = data && isRelationshipResponse(data) ? data : undefined;

    // Legacy-style edge filter: hidden edge kinds are stripped before running when applied to every query,
    // or for the current query after Recalculate
    const edgeFilter = useEdgeFilter();
    const queryHiddenEdgeKinds = getQueryHiddenEdgeKinds(edgeFilter, params.cypherSearch);

    const query = exploreGraphQueryFactory(params, { userSettings, relationshipDetails, queryHiddenEdgeKinds });

    const queryConfig = query.getQueryConfig();

    return useQuery({
        ...queryConfig,
        onError: (error: any) => {
            const { message, key } = query.getErrorMessage(error);
            if (onError) {
                onError(message);
            }

            addNotification(message, key, {
                autoHideDuration: SNACKBAR_DURATION_LONG,
            });
        },
        ...rest,
        ...userSettings,
    });
};

export type UserSettings = {
    headers?: {
        Prefer: string;
    };
};

export const useUserSettings = () => {
    const timeoutLimitEnabled = useTimeoutLimitConfiguration();

    const persistedStateString = localStorage.getItem('persistedState');
    const persistedState = persistedStateString !== null ? JSON.parse(persistedStateString) : null;
    const isDisableQueryLimit = persistedState?.global?.view?.timeoutSetting;

    const settings: UserSettings = {
        headers: { Prefer: '' },
    };

    if (isDisableQueryLimit && timeoutLimitEnabled === false) {
        settings.headers = { Prefer: 'wait=-1' };
    } else {
        delete settings.headers;
    }

    return settings;
};
