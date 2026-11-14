# Legacy view for BloodHound CE

This branch (`legacy-view`, based on CE `v9.8.0`) changes **only how the Explore graph is drawn**.
Ingest, post-processing, edge creation, Tier Zero tagging, the API and storage are untouched, so
it works the same whether CE stores its graph in Neo4j or PostgreSQL.

## What changes

| Goal | How |
| --- | --- |
| Left-to-right, whole graph on one screen | The dagre layout is stretched to the screen's shape (`stretchToAspect`), so ranks spread across the full width and the tallest rank fills the height. Reset always fits the visible graph, and the zoom-out cap is raised from 15 to 500. |
| Readable at full zoom-out | Nodes and labels keep a readable size at the fitted view and grow smoothly as you zoom in (like Legacy), reaching CE's normal size at 1:1. Labels are single-line (no "Active Directory \| User" sublabel), and are only dropped where they would sit almost exactly on top of each other. Edge labels are drawn at 16/22 of the node label size, Legacy's default ratio (22px node, 16px edge labels). The **N−/N+** and **E−/E+** buttons next to the graph controls make node and edge labels smaller or bigger separately, like Legacy's Node and Edge label size settings (each remembered in your browser). |
| Less clutter | Legacy-style node collapse: when a node has 5 or more leaf neighbours, the leaves are hidden and the node shows a black count bubble; hovering the node says what is folded in (e.g. "694 Computers folded in (HasSession)"). **Double-click** the node, or **right-click → Expand N collapsed nodes**, to expand them; the layout re-runs and the view refits so they settle into the columns. **Right-click → Collapse N nodes** folds them back the same way. The layer button turns collapsing off and on, and selecting a hidden node (for example from search) expands its parent. |
| Path highlight | CE 9.x dims everything that isn't on a path through the selected node. The route button toggles that on and off (CE has the setting but no button for it). |
| Legacy-style look | Icons are drawn at 75% of CE's size, node labels in regular weight and edges 1.5 times as wide so names stand out, and edges taper from a wider source end to a narrower target end at every zoom (the edge shaders scale the whole edge to meet sigma's minimum width, instead of flattening each end to it). No white box behind node or edge labels. Edge labels are drawn along the edge, just above the line, and never upside down; they get the same readable-size floor as node labels. Parallel edges between the same two nodes are spread so each label sits on its own curve. A selected node's label shows in the highlight color. |
| Bug fixes (upstream) | Hidden nodes are zeroed for the whole triangle in the node and glyph WebGL programs (upstream zeroed one vertex, which drew stray wedges). Each node program binds its own icon texture before drawing (upstream used whatever was bound last, so icons vanished on hover or selection). Drag state is kept in a ref, so a quick click can no longer leave a node stuck to the mouse. Hidden edges are no longer clickable. Curved (parallel) edges were looked up by their `rel_<id>` key as if it were `source_kind_target`, so they never got their own curve; they are now looked up by `exploreGraphId`. |

Nearly all of the logic is in `cmd/ui/src/rendering/legacyView.ts`, with small hooks in the files it
plugs into. That keeps rebases onto new CE releases small. Tunables (collapse threshold, size and label
floors, declutter, label boxes, sublabels, edge-label style) are constants in that file.

Node names: labels up to 40 characters are shown in full (CE cuts at 20). Longer ones lose part of
their domain, never the name before `@` (or before the first `.` for computers), and labels with a SID
are never shortened. CE's own "label clipping" setting still turns shortening off entirely.

## Query sets and pickers

The Saved Queries panel has a **Sophos Queries / BloodHound CE** switch (remembered in your browser).
BloodHound CE lists CE's own built-in queries; Sophos Queries lists a local set of review queries. Your
saved queries show under both. The Platforms filter picks Active Directory or Entra ID, and the
Categories list only offers that platform's categories.

The Sophos set lives in `packages/javascript/bh-shared-ui/src/commonSearchesSophos.ts`. The repository
copy is empty on purpose: the real queries are generated locally and never committed (the file is
marked `skip-worktree`, so git ignores the local copy).

Pre-built queries can carry a Legacy-style **picker** (`QueryPicker` in `types.ts`): clicking the query
opens a dialog such as "Select a Domain..." that lists the nodes its `options` query returns (with a single
option it just runs). Choosing
one runs the picker's query with `$result` replaced by that node's name; **Run for all** runs the query
as listed.

This UI expects a CE 9.x server. Against CE 8.x the node panel and the right-click menu stay empty,
because 8.x has no `/api/v2/nodes/{id}` endpoint. Graphs still draw: 8.x sends edges without ids, and
the UI falls back to a source/kind/target key for them.

## Saved queries open by default

Opening the Cypher tab always shows the saved queries expanded; the toggle still collapses them for that visit.

## Reachable Tier Zero Targets

Legacy's **Reachable High Value Targets** is back in the node panel, under Object Information and above Sessions.
CE calls high value *Tier Zero* (the `Tag_Tier_Zero` label), so it is named **Reachable Tier Zero Targets**.

- The count is every Tier Zero object the selected node reaches by a shortest path over traversable edges (CE's
  pathfinding edge list for AD and Azure), including Tier Zero objects on the way.
- Clicking it only draws those paths, as in Legacy (it never opens into a list, since the count can run into the
  hundreds). The paths run as a Cypher query, so they show on the Cypher tab and can be edited, and the node stays
  selected.
- The count is usually higher than Legacy's for the same data: CE tags far more objects Tier Zero than Legacy marked
  high value (the GPOs, OUs, containers and certificate templates that control Tier Zero, not just the admin
  groups, Domain and DCs).

## Save as PNG

**Export > PNG** saves the graph exactly as it is on screen (at screen resolution, on the current light or dark
background). **Export > PNG options…** sets where and how:

- **Folder**: chosen once with *Choose…* and remembered across reloads; *Change…* picks another. If the browser
  has forgotten write access (after a restart), the next save asks to allow it again.
- **File name**: the name before the number (default `bloodhound`).
- **Number the files automatically**: on, each save goes straight into the folder as the next free number,
  `bloodhound-001.png`, `bloodhound-002.png`, … (it looks at what is already in the folder, so it never
  overwrites). Off, a Save As dialog opens in that folder for each PNG.

Picking a folder needs Chrome or Edge (File System Access API). **Firefox and Safari** do not let a page choose
or write into a folder, so there each PNG is a download with the numbered name:

- Turn on Firefox **Settings > General > Downloads > Always ask you where to save files** to choose the folder:
  the Save box opens in the folder used last, with the numbered name filled in.
- The page cannot see that folder, so the number is remembered per file name (a new name starts at 001) and the
  dialog has a **Next number** field to set or reset it.

## Back button

The ← button just left of the filter icon steps back to the previous graph (a browser back: every search,
pathfinding and Cypher query is in the URL, so going back reruns the one before).

## Edge filter

The filter button at the right end of the Search / Pathfinding / Cypher tab bar opens a Legacy-style **Edge Filter**. It lists only the edge
types in the current graph, with counts, grouped like CE's pathfinding filter. Unticking a type hides
those edges at once; **Hide nodes left without edges** also hides nodes that only had hidden edges. Unticked types
move to a **Hidden** group at the top, even once they are no longer in the graph, so they can be ticked back.
**Apply filter to every query** goes further, like Legacy: the unticked types are removed from every
multi-type edge list in the Cypher query (`-[:A|B|C*1..]->`) and the query re-runs, so paths around them
show up. Single-type patterns such as `-[:HasSession]->` are left as written. On the Cypher tab, **Recalculate** does
the same once for the current query, without switching that option on. The current ticks can be
saved as named **views**. The filter and views are kept in your browser.

## Exclude from query

**Right-click a node → Exclude from query** takes that object out of every Cypher query and re-runs the
current one. Named paths are filtered as a whole (`WHERE NONE(excluded_node IN nodes(p) WHERE
excluded_node.objectid IN [...])`), so shortest paths go around the excluded object; patterns without a path name
filter each named node (`NOT n.objectid IN [...]`). An existing `WHERE` is kept and the filter is ANDed to it. The
editor keeps the query as written: the filter is added when the query runs, like the edge filter's.

The **Excluded (n)** button next to Tag / Save on the Cypher tab lists the excluded objects (by name, matched by
objectid), each with an × to bring it back, and **Clear all**. While anything is excluded, an eye-slash icon with
the count also shows in the Search / Pathfinding / Cypher tab bar (it opens the same list), so it stays visible
when the search panel is collapsed. The list is kept in your browser and stays on for the next query. Excluded
objects are also hidden in the drawn graph, which covers node search, pathfinding (which do not run your Cypher)
and patterns the rewrite cannot reach (only anonymous nodes, such as `(:User)`).

## Large queries (server config, no code change)

CE has no row cap on Cypher results. Large queries are cut off by three server limits, all
configurable:

```yaml
# docker-compose.yml, bloodhound service, environment:
bhe_disable_cypher_complexity_limit: "true"   # default false: rejects "complex" queries
bhe_graph_query_memory_limit: 8               # GiB, default 2
```

Query timeout: in **Administration → Configuration**, turn off the Explore query timeout limit, then
enable the per-user "disable query limit" toggle in the Cypher panel (the UI then sends `Prefer: wait=-1`).

## Building

```bash
node .yarn/releases/yarn-4.13.0.cjs install
cd cmd/ui && node ../../.yarn/releases/yarn-4.13.0.cjs dev   # proxies the API to localhost:8080
```

To ship it, build the normal CE image from this branch (`dockerfiles/bloodhound.Dockerfile`) and use
that image in place of `specterops/bloodhound` in your compose file.
