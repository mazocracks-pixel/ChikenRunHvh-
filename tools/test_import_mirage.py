import unittest
from import_mirage import parse_material

class Materials(unittest.TestCase):
    def test_quoted_and_unquoted_keys_and_patch_blocks(self):
        shader, data = parse_material('''// Source materials commonly omit quotes on keys.
        VertexLitGeneric {
            $baseTexture "models/props/tree"
            "$alphatest" "1"
            $surfaceprop wood
            <dx90 { $basetexture "old/texture" }
        }''')
        self.assertEqual(shader, 'vertexlitgeneric')
        self.assertEqual(data['$basetexture'], 'models/props/tree')
        self.assertEqual(data['$alphatest'], '1')
        self.assertEqual(data['<dx90']['$basetexture'], 'old/texture')
        shader, data = parse_material('Patch { include "base.vmt" replace { $basetexture "new/texture" } }')
        self.assertEqual(data['replace']['$basetexture'], 'new/texture')
    def test_missing_closing_brace_is_rejected(self):
        with self.assertRaises(ValueError): parse_material('LightmappedGeneric { $basetexture test')

if __name__ == '__main__': unittest.main()
