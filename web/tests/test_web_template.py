"""Validate prepared browser assets using only Python's standard library."""
import json
from pathlib import Path
import struct
import unittest

ROOT = Path(__file__).resolve().parents[1]/'public/template'


def glb(path):
    data = path.read_bytes()
    magic, version, length = struct.unpack_from('<III',data)
    assert magic == 0x46546c67 and version == 2 and length == len(data)
    size = struct.unpack_from('<I',data,12)[0]
    return json.loads(data[20:20+size]),data[28+size:]


def values(document, binary, accessor):
    a=document['accessors'][accessor];v=document['bufferViews'][a['bufferView']]
    assert a['componentType']==5126
    components={'SCALAR':1,'VEC3':3,'VEC4':4}[a['type']]
    offset=v.get('byteOffset',0)+a.get('byteOffset',0)
    return struct.unpack_from('<'+'f'*(a['count']*components),binary,offset)


class BrowserTemplateTests(unittest.TestCase):
    def test_template_timing_and_all_variants(self):
        manifest=json.loads((ROOT/'manifest.json').read_text())
        self.assertTrue(manifest['validated'])
        self.assertEqual(len(manifest['slots']),12)
        self.assertEqual(manifest['frames'],85)
        self.assertEqual(len(manifest['cameras']),85)
        self.assertEqual(len(manifest['durations']),85)
        self.assertEqual(sum(manifest['durations']),2830)
        for slot in manifest['slots']:
            self.assertGreaterEqual(slot['appearance']['duration_ms'],600)
            for model in ('classic','slim'):
                with self.subTest(slot=slot['id'],model=model):
                    d,b=glb(ROOT/slot['models'][model])
                    self.assertFalse(d.get('images'), 'Prepared rigs must contain no original player textures')
                    self.assertEqual(len(d['skins'][0]['joints']),14)
                    self.assertEqual(len(d['meshes']),12)
                    self.assertEqual(len(d['animations']),1)
                    animation=d['animations'][0]
                    root=d['scenes'][0]['nodes'][0]
                    channel=next(c for c in animation['channels'] if c['target']==dict(node=root,path='translation'))
                    sampler=animation['samplers'][channel['sampler']]
                    times=values(d,b,sampler['input']);positions=values(d,b,sampler['output'])
                    self.assertAlmostEqual(min(times),0,places=5)
                    self.assertAlmostEqual(max(times),84/30,places=5)
                    # Regression: exporting many rigs in one Blender scene used to
                    # silently bind the center action to every other position.
                    self.assertAlmostEqual(positions[0],slot['position'][0],places=5)
                    self.assertAlmostEqual(positions[2],-slot['position'][1],places=5)
                    self.assertNotEqual(positions[:3],positions[-3:])
        for layer in manifest['atlases'].values():
            self.assertEqual(sum(a['count'] for a in layer),85)
            for atlas in layer:self.assertTrue((ROOT/atlas['url']).is_file())

    def test_full_cast_visibility_and_collisions(self):
        report=json.loads((ROOT/'validation.json').read_text())
        self.assertTrue(report['validated'])
        self.assertEqual(report['frames'],85)
        self.assertEqual(report['variant_pairs_per_frame'],264)
        self.assertTrue(report['conservative_variant_union'])
        self.assertEqual(report['collisions'],[])
        self.assertEqual(report['visibility']['failures'],[])


if __name__=='__main__':unittest.main()
