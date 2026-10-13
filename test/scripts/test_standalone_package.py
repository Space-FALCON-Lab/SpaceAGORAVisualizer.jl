"""Package-local builder behavior; no data catalogs or network are required."""
import base64
import contextlib
import importlib.util
import io
import pathlib
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('standalone_builder', ROOT / 'viewer' / 'build_standalone.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)

class StandalonePackage(unittest.TestCase):
    def test_default_page_does_not_require_texture_catalog(self):
        with tempfile.TemporaryDirectory() as directory:
            target = pathlib.Path(directory) / 'viewer.html'
            with patch.object(sys, 'argv', ['builder', '--out', str(target)]), contextlib.redirect_stdout(io.StringIO()) as output:
                builder.main()
            html = target.read_text()
            self.assertIn('textures: none', output.getvalue())
            self.assertNotIn('__TEXTURES__', html)
            self.assertNotIn('__IMPORTMAP__', html)
            self.assertIn('data:text/javascript;base64,', html)
            self.assertNotIn('<script src="https://', html)

    def test_explicit_catalog_preserves_texture_metadata_and_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            catalog = pathlib.Path(directory)
            raw = b'fixture-image-bytes'
            (catalog / 'earth.png').write_bytes(raw)
            (catalog / 'manifest.toml').write_text('''version = 1
[[texture]]
body = "Earth"
file = "earth.png"
resolution = "4k"
lon_left_deg = -90.0
width = 4
height = 2
source = "synthetic fixture"
license = "test-only"
''')
            table = builder.texture_table('4k', {'earth'}, catalog)
            self.assertEqual(set(table), {'earth'})
            self.assertEqual(base64.b64decode(table['earth']['url'].split(',')[1]), raw)
            self.assertEqual(table['earth']['lon_left_deg'], -90.0)
            self.assertEqual(table['earth']['source'], 'synthetic fixture')
            target = catalog / 'viewer.html'
            with patch.object(sys, 'argv', ['builder', '--out', str(target), '--textures', '4k', '--textures-dir', str(catalog)]), contextlib.redirect_stdout(io.StringIO()):
                builder.main()
            self.assertIn(table['earth']['url'], target.read_text())

    def test_requested_missing_catalog_fails_before_output_write(self):
        with tempfile.TemporaryDirectory() as directory:
            target = pathlib.Path(directory) / 'viewer.html'
            target.write_text('previous output')
            with patch.object(sys, 'argv', ['builder', '--out', str(target), '--textures', '4k', '--textures-dir', str(target.parent / 'missing')]):
                with self.assertRaises(FileNotFoundError):
                    builder.main()
            self.assertEqual(target.read_text(), 'previous output')

if __name__ == '__main__':
    unittest.main()
