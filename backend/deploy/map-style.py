#!/usr/bin/env python3
"""Builds our map style (backend/public/map/style.json) from OpenFreeMap's free "liberty" style.

Owner's wish (Oct 2026): a map like inDrive's night map, neither black nor white: dark grey towns, brownish land, dark
green parks, ochre main roads, blue-grey streets, readable light labels and coloured place icons. Only the colours change;
tiles, icons and fonts still come from OpenFreeMap (free, no key). Run again to refresh from a newer liberty style:
    curl -sS https://tiles.openfreemap.org/styles/liberty -o /tmp/liberty.json
    python3 backend/deploy/map-style.py /tmp/liberty.json backend/public/map/style.json
"""
import json, sys

src, out = sys.argv[1], sys.argv[2]
s = json.load(open(src))

LAND = '#3E3A39'        # the land itself: dark grey, like the reference
TOWN = '#423E3B'        # built-up areas (a touch lighter)
BUILDING = '#484442'
GREEN = '#264C35'       # parks, grass
WOOD = '#26432F'
WATER = '#22344A'
MINOR = '#4B5769'       # streets (blue-grey)
MAJOR = '#8A7737'       # main roads (ochre)
MOTORWAY = '#A0873A'
CASING = '#2C2A29'
RAIL = '#5A5654'
TEXT, HALO = '#C5C9CE', '#2A2827'
PLACE = '#E1E3E6'

def paint(layer, **kv):
    p = layer.setdefault('paint', {})
    for k, v in kv.items(): p[k.replace('_', '-')] = v

layers = []
for l in s['layers']:
    i, t = l['id'], l['type']
    if t == 'raster': continue                                  # bright shaded relief: not on a dark map
    if i == 'background': paint(l, background_color=LAND)
    elif i == 'landuse_residential': paint(l, fill_color=TOWN, fill_opacity=1)
    elif i in ('park',): paint(l, fill_color=GREEN, fill_outline_color=GREEN)
    elif i == 'park_outline': paint(l, line_color=GREEN)
    elif i == 'landcover_wood': paint(l, fill_color=WOOD)
    elif i in ('landcover_grass', 'landuse_pitch', 'landuse_track', 'landuse_cemetery'): paint(l, fill_color=GREEN)
    elif i in ('landuse_hospital', 'landuse_school'): paint(l, fill_color='#433E3D')
    elif i == 'landcover_sand': paint(l, fill_color='#47402F')   # sand, bare land: the brownish tone of the reference
    elif i == 'landcover_ice': paint(l, fill_color='#5A5E62')
    elif i.startswith('water') and t == 'fill' or i == 'water': paint(l, fill_color=WATER)
    elif i.startswith('waterway') and t == 'line': paint(l, line_color=WATER)
    elif i.startswith('aeroway'):
        if t == 'fill': paint(l, fill_color='#45413F')
        else: paint(l, line_color='#5A5654')
    elif t == 'line' and ('rail' in i):
        paint(l, line_color=RAIL)
    elif t == 'line' and i.endswith('_casing'):
        paint(l, line_color=CASING)
    elif t == 'line' and ('motorway' in i):
        paint(l, line_color=MOTORWAY)
    elif t == 'line' and any(k in i for k in ('trunk_primary', 'secondary_tertiary', '_link')):
        paint(l, line_color=MAJOR)
    elif t == 'line' and any(k in i for k in ('minor', 'street', 'service_track')):
        paint(l, line_color=MINOR)
    elif t == 'line' and 'path_pedestrian' in i:
        paint(l, line_color='#575250', line_opacity=0.7)
    elif i == 'building': paint(l, fill_color=BUILDING, fill_outline_color='#3A3634')
    elif i == 'building-3d': paint(l, fill_extrusion_color=BUILDING)
    elif t == 'line' and i.startswith('boundary'): paint(l, line_color='#6B6662')
    elif t == 'symbol':
        p = l.get('paint', {})
        if 'text-color' in p or l.get('layout', {}).get('text-field') is not None:
            col = PLACE if i.startswith('label_') else '#8FB3E0' if i.startswith('water') or i.startswith('waterway') else TEXT
            paint(l, text_color=col, text_halo_color=HALO, text_halo_width=1.2)
    layers.append(l)

s['layers'] = layers
s['name'] = 'Delivery night (from OpenFreeMap liberty)'
json.dump(s, open(out, 'w'), separators=(',', ':'))
print('wrote', out, len(layers), 'layers')
