/**
 * Grid A\* over the walkability grid (§1, §5).
 *
 * Eight-connected, because a four-connected path on a 2 m grid produces staircase movement
 * that reads as a bug rather than as a route. Diagonal steps are refused when either
 * orthogonal neighbour is blocked, so nothing ever squeezes through the corner where two
 * walls meet — a gap that exists on the grid but not in the world the capsule moves
 * through.
 *
 * The result is then pulled straight: any waypoint the previous one can see is dropped.
 * Without that, an enemy crossing an open room visits every tile centre on the way and
 * arrives looking like it is following a tiled floor pattern.
 *
 * Pure functions over a minimal grid interface — no Three.js, no entities — so paths can
 * be asserted directly in tests.
 */

/** All A\* needs from the walkability grid (§2), which satisfies this structurally. */
export interface PathGrid {
  readonly width: number;
  readonly height: number;
  isWalkable(gx: number, gy: number): boolean;
}

export interface GridPoint {
  x: number;
  y: number;
}

/** Straight-line cost of a diagonal step, against 1 for an orthogonal one. */
const DIAGONAL = Math.SQRT2;

/** Ceiling on expanded nodes, so an unreachable goal cannot stall a frame. */
const DEFAULT_NODE_BUDGET = 6000;

/**
 * Octile distance: the exact cost of the cheapest unobstructed eight-connected route, so
 * the heuristic is admissible and A\* expands as few nodes as it can get away with.
 */
function heuristic(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return dx + dy + (DIAGONAL - 2) * Math.min(dx, dy);
}

/**
 * Binary min-heap keyed on f-score. A sorted array would be simpler and would show up as
 * a frame spike the first time an enemy paths across the whole map.
 */
class MinHeap {
  private readonly items: number[] = [];
  private readonly scores: number[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: number, score: number): void {
    this.items.push(item);
    this.scores.push(score);
    let index = this.items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if ((this.scores[parent] ?? 0) <= (this.scores[index] ?? 0)) break;
      this.swap(index, parent);
      index = parent;
    }
  }

  pop(): number | undefined {
    if (this.items.length === 0) return undefined;
    const top = this.items[0];
    const lastItem = this.items.pop()!;
    const lastScore = this.scores.pop()!;
    if (this.items.length > 0) {
      this.items[0] = lastItem;
      this.scores[0] = lastScore;
      let index = 0;
      for (;;) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        if (left < this.items.length && (this.scores[left] ?? 0) < (this.scores[smallest] ?? 0)) {
          smallest = left;
        }
        if (right < this.items.length && (this.scores[right] ?? 0) < (this.scores[smallest] ?? 0)) {
          smallest = right;
        }
        if (smallest === index) break;
        this.swap(index, smallest);
        index = smallest;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    const item = this.items[a]!;
    this.items[a] = this.items[b]!;
    this.items[b] = item;
    const score = this.scores[a]!;
    this.scores[a] = this.scores[b]!;
    this.scores[b] = score;
  }
}

/**
 * Whether a straight line between two tile centres stays on walkable ground.
 *
 * Used twice: to pull a path straight, and by the enemies to decide whether they can see
 * the player at all — an enemy with a clear line walks at them, and one without has to
 * path (§5). Diagonal steps are checked the same way A\* checks them, so the test cannot
 * approve a route through a corner that A\* would refuse.
 */
export function hasLineOfSight(
  grid: PathGrid,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): boolean {
  let x = ax;
  let y = ay;
  const dx = Math.abs(bx - ax);
  const dy = Math.abs(by - ay);
  const stepX = ax < bx ? 1 : -1;
  const stepY = ay < by ? 1 : -1;

  if (!grid.isWalkable(x, y)) return false;

  // Bresenham-style walk that never skips a tile: on a tie it takes both orthogonal steps
  // rather than cutting the corner between them.
  let error = dx - dy;
  let guard = dx + dy + 2;
  while ((x !== bx || y !== by) && guard-- > 0) {
    const doubled = error * 2;
    const stepsX = doubled > -dy;
    const stepsY = doubled < dx;

    if (stepsX && stepsY) {
      // A diagonal move: both of the tiles it passes between have to be open.
      if (!grid.isWalkable(x + stepX, y) || !grid.isWalkable(x, y + stepY)) return false;
      x += stepX;
      y += stepY;
      error += dx - dy;
    } else if (stepsX) {
      x += stepX;
      error -= dy;
    } else {
      y += stepY;
      error += dx;
    }

    if (!grid.isWalkable(x, y)) return false;
  }

  return x === bx && y === by;
}

/** Drop every waypoint the one before it can already see. */
export function smoothPath(grid: PathGrid, path: readonly GridPoint[]): GridPoint[] {
  if (path.length <= 2) return [...path];

  const result: GridPoint[] = [path[0]!];
  let anchor = 0;
  for (let i = 2; i < path.length; i += 1) {
    const from = path[anchor]!;
    const to = path[i]!;
    if (!hasLineOfSight(grid, from.x, from.y, to.x, to.y)) {
      anchor = i - 1;
      result.push(path[anchor]!);
    }
  }
  result.push(path[path.length - 1]!);
  return result;
}

export interface PathOptions {
  /** Ceiling on expanded nodes; a search that hits it gives up rather than stalling. */
  nodeBudget?: number;
  /** Pull the path straight afterwards. On by default; off makes tests easier to read. */
  smooth?: boolean;
}

/**
 * Cheapest route from one tile to another, excluding the starting tile, or `null` when
 * there is none.
 *
 * A blocked *goal* is a miss rather than a failure in one case: enemies path at the player,
 * and the player can stand somewhere the grid calls unwalkable (a gate closing under them,
 * a rounding edge). The caller decides what to do about that; this reports honestly.
 */
export function findPath(
  grid: PathGrid,
  startX: number,
  startY: number,
  goalX: number,
  goalY: number,
  options: PathOptions = {},
): GridPoint[] | null {
  const { nodeBudget = DEFAULT_NODE_BUDGET, smooth = true } = options;

  if (!grid.isWalkable(startX, startY) || !grid.isWalkable(goalX, goalY)) return null;
  if (startX === goalX && startY === goalY) return [];

  const { width, height } = grid;
  const size = width * height;
  const index = (x: number, y: number): number => y * width + x;

  const cameFrom = new Int32Array(size).fill(-1);
  const cost = new Float64Array(size).fill(Number.POSITIVE_INFINITY);
  const closed = new Uint8Array(size);

  const startIndex = index(startX, startY);
  const goalIndex = index(goalX, goalY);
  cost[startIndex] = 0;

  const open = new MinHeap();
  open.push(startIndex, heuristic(startX, startY, goalX, goalY));

  let expanded = 0;
  while (open.size > 0) {
    const current = open.pop()!;
    if (current === goalIndex) return build(cameFrom, current, width, grid, smooth);
    if (closed[current] === 1) continue;
    closed[current] = 1;

    if (++expanded > nodeBudget) break;

    const cx = current % width;
    const cy = (current - cx) / width;
    const currentCost = cost[current] ?? 0;

    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;

        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (!grid.isWalkable(nx, ny)) continue;

        // No cutting the corner where two walls meet: the gap is on the grid, not in the
        // world the enemy's body has to move through.
        if (dx !== 0 && dy !== 0) {
          if (!grid.isWalkable(cx + dx, cy) || !grid.isWalkable(cx, cy + dy)) continue;
        }

        const neighbour = index(nx, ny);
        if (closed[neighbour] === 1) continue;

        const step = dx !== 0 && dy !== 0 ? DIAGONAL : 1;
        const tentative = currentCost + step;
        if (tentative >= (cost[neighbour] ?? Number.POSITIVE_INFINITY)) continue;

        cost[neighbour] = tentative;
        cameFrom[neighbour] = current;
        open.push(neighbour, tentative + heuristic(nx, ny, goalX, goalY));
      }
    }
  }

  return null;
}

function build(
  cameFrom: Int32Array,
  goal: number,
  width: number,
  grid: PathGrid,
  smooth: boolean,
): GridPoint[] {
  const reversed: GridPoint[] = [];
  let node = goal;
  while (node !== -1) {
    const x = node % width;
    reversed.push({ x, y: (node - x) / width });
    node = cameFrom[node] ?? -1;
  }
  reversed.reverse();

  const path = smooth ? smoothPath(grid, reversed) : reversed;
  // The starting tile is where the enemy already is; it is not a waypoint.
  return path.slice(1);
}
