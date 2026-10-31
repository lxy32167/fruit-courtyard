"""Convert the user's extracted Unity levels to small, solvability-checked packs."""
import collections
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT.parent / 'reference/arrows-0.24.0'
PACK_SIZE = 64


def solve(level):
    w, h, arrows = level['w'], level['h'], level['a']
    occupied = collections.defaultdict(set)
    paths = []
    for index, arrow in enumerate(arrows):
        points = [(i % w * 2, i // w * 2) for i in arrow]
        paths.append(points)
        for (x, y), (xx, yy) in zip(points, points[1:]):
            steps = math.gcd(abs(xx - x), abs(yy - y))
            if not steps:
                raise ValueError('Repeated point')
            for step in range(steps + 1):
                occupied[x + (xx - x) // steps * step, y + (yy - y) // steps * step].add(index)
    blockers = []
    for index, points in enumerate(paths):
        x, y = points[0]
        dx, dy = x - points[1][0], y - points[1][1]
        steps = math.gcd(abs(dx), abs(dy))
        dx, dy = dx // steps, dy // steps
        blocked_by = set()
        x, y = x + dx, y + dy
        while 0 <= x <= (w - 1) * 2 and 0 <= y <= (h - 1) * 2:
            blocked_by.update(occupied.get((x, y), ()))
            x, y = x + dx, y + dy
        blocked_by.discard(index)
        blockers.append(blocked_by)
    remaining = set(range(len(arrows)))
    layers = 0
    while remaining:
        free = {i for i in remaining if not blockers[i] & remaining}
        if not free:
            return False, layers
        remaining -= free
        layers += 1
    return True, layers


def main():
    manifest = {'version': 1, 'packSize': PACK_SIZE, 'modes': {}}
    for mode in ('main', 'daily', 'thunderrush'):
        raw = json.loads((SOURCE / f'levels-{mode}.json').read_text())
        levels, rejected = [], []
        for item in raw:
            data = item['data']
            level = {'id': str(item['pathId']), 'w': data['XSize'], 'h': data['YSize'],
                     'a': [a['CompactIndices'] for a in data['Arrows']]}
            solved, depth = solve(level)
            if solved:
                level['depth'] = depth
                levels.append(level)
            else:
                rejected.append(item['name'])
        if mode == 'main':
            levels.sort(key=lambda l: (len(l['a']), l['w'] * l['h'], l['depth'], l['id']))
            tutorial_id = next(str(l['pathId']) for l in raw if l['name'] == 'OG_Level0_1')
            levels.sort(key=lambda l: l['id'] != tutorial_id)
        else:
            levels.sort(key=lambda l: l['id'])
        packs = []
        for start in range(0, len(levels), PACK_SIZE):
            name = f'{mode}-{start // PACK_SIZE:03d}.json'
            (ROOT / 'data' / name).write_text(json.dumps(levels[start:start + PACK_SIZE], separators=(',', ':')))
            packs.append(name)
        manifest['modes'][mode] = {'count': len(levels), 'packs': packs,
                                  'sizes': [len(l['a']) for l in levels]}
        print(mode, 'accepted:', len(levels), 'rejected:', len(rejected), flush=True)
        if rejected:
            print('Rejected examples:', rejected[:8], flush=True)
    (ROOT / 'data/manifest.json').write_text(json.dumps(manifest, separators=(',', ':')))


if __name__ == '__main__':
    main()
