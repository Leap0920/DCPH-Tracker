export type WrappedBackground = {
  id: string
  /** Display label in the picker */
  name: string
  /** Filename inside public/cards (spaces allowed) */
  file: string
  /** object-position for the full-bleed background */
  focus?: string
}

/**
 * Backgrounds offered by /wrapped, served from public/cards.
 *
 * Every entry here must have its file present in public/cards: the picker and
 * the exported card both render these paths directly, and the folder is not
 * scanned at runtime, so an entry without a file is a broken image rather than
 * a missing option. Adding a background = drop the file in public/cards and add
 * a line here. (Character portraits for /characters live in public/characters
 * and are mapped separately in lib/characters-guide.ts.)
 *
 * Entries past the first block carry the filenames the images arrived with, so
 * a duplicate character appears several times. Labels ending in "Unknown <hash>"
 * mean the artwork was not identifiable — they are placeholders, not names.
 */
export const WRAPPED_BACKGROUNDS: WrappedBackground[] = [
  { id: "conan", name: "Conan Edogawa", file: "Conan Edogawa.jpg", focus: "50% 20%" },
  { id: "ran", name: "Ran Mouri", file: "Ran Mouri.jpg", focus: "50% 20%" },
  { id: "heiji", name: "Heiji Hattori", file: "Heiji Hattori.jpg", focus: "50% 20%" },
  { id: "kid", name: "Kaitou Kid", file: "Kaitou Kid Kaito Kuroba.jpg", focus: "50% 20%" },
  { id: "akai", name: "Shuichi Akai", file: "Shuichi Akai.jpg", focus: "50% 20%" },
  { id: "gin", name: "Gin", file: "Gin.jpg", focus: "50% 20%" },
  { id: "vermouth", name: "Vermouth", file: "Vermouth Chris Vineyard.jpg", focus: "50% 20%" },
  { id: "kazuha", name: "Kazuha Toyama", file: "kazuha toyama.jpg", focus: "50% 20%" },
  { id: "kogoro", name: "Kogoro Mouri", file: "Kogoro Mouri.jpg", focus: "50% 20%" },
  { id: "makoto", name: "Makoto Kyogoku", file: "Makoto Kyogoku.jpg", focus: "50% 20%" },
  { id: "takagi", name: "Wataru Takagi", file: "Officer Wataru Takagi.jpg", focus: "50% 20%" },
  { id: "megure", name: "Juzo Megure", file: "Inspector Juzo Megure.jpg", focus: "50% 20%" },
  { id: "agasa", name: "Professor Agasa", file: "Hiroshi Agasa.jpg", focus: "50% 20%" },
  { id: "jodie", name: "Jodie Starling", file: "Jodie Starling.jpg", focus: "50% 20%" },
  { id: "chianti", name: "Chianti", file: "Chianti.jpg", focus: "50% 20%" },
  { id: "korn", name: "Korn", file: "Korn.jpg", focus: "50% 20%" },
  { id: "karasuma", name: "Renya Karasuma", file: "Renya Karasuma.jpg", focus: "50% 20%" },
  { id: "akemi", name: "Akemi Miyano", file: "Akemi Miyano.jpg", focus: "50% 20%" },
  { id: "yusaku", name: "Yusaku Kudo", file: "yusakukudo.jpg", focus: "50% 20%" },
  { id: "aoko", name: "Aoko Nakamori", file: "Aoko Nakamori.jpg", focus: "50% 20%" },
  { id: "toichi", name: "Toichi Kuroba", file: "Toichi Kuroba.jpg", focus: "50% 20%" },
  { id: "chikage", name: "Chikage Kuroba", file: "Chikage Kuroba.jpg", focus: "50% 20%" },
  { id: "ginzo", name: "Ginzo Nakamori", file: "Inspector Ginzo Nakamori.jpg", focus: "50% 20%" },
  { id: "kansuke", name: "Kansuke Yamato", file: "Kansuke yamato.jpg", focus: "50% 20%" },
  { id: "shiratori", name: "Ninzaburo Shiratori", file: "Ninzaburo Shiratori.jpg", focus: "50% 20%" },
  { id: "naeko", name: "Naeko Miike", file: "Naeko Miike.jpg", focus: "50% 20%" },
  { id: "shizuka-hattori", name: "Shizuka Hattori", file: "shizuka hattori.jpg", focus: "50% 20%" },
  { id: "heizo", name: "Heizo Hattori", file: "Heizo Hattori.jpg", focus: "50% 20%" },
  { id: "momiji", name: "Momiji Ooka", file: "Ooka Mimoji.jpg", focus: "50% 20%" },
  { id: "muga-iori", name: "Muga Iori", file: "Iori Muga.jpg", focus: "50% 20%" },
  { id: "soshi-okita", name: "Soshi Okita", file: "Okita Soshi.jpg", focus: "50% 20%" },
  { id: "rumi-wakasa", name: "Rumi Wakasa", file: "Rumi Wakasa.jpg", focus: "50% 20%" },
  { id: "eisuke", name: "Eisuke Hondo", file: "Hondo Eisuke.jpg", focus: "50% 20%" },
  { id: "yoko-okino", name: "Yoko Okino", file: "Yoko Okino.jpg", focus: "50% 20%" },
  { id: "yamamura", name: "Misao Yamamura", file: "Misao yamamura.jpg", focus: "50% 20%" },
  { id: "haibara", name: "Ai Haibara", file: "289395a9c7a85719c81b20665c80f5e6.jpg", focus: "50% 20%" },
  { id: "haibara-2", name: "Ai Haibara (2)", file: "83a5d492d52880fd48735c0bba4f567c.jpg", focus: "50% 20%" },
  { id: "haibara-3", name: "Ai Haibara (3)", file: "e20c3319cacf6562cf6f4ee8cb59ef87.jpg", focus: "50% 20%" },
  { id: "haibara-4", name: "Ai Haibara (4)", file: "e70a1a08fcee1ed6eb2ab8b7acc3f024.jpg", focus: "50% 20%" },
  { id: "haibara-5", name: "Ai Haibara (5)", file: "fc78d3d3806117e1868971230074af07.jpg", focus: "50% 20%" },
  { id: "ayumi", name: "Ayumi Yoshida", file: "42a98c6f5bd0f4964e1ee1f207d06775.jpg", focus: "50% 20%" },
  { id: "ayumi-2", name: "Ayumi Yoshida (2)", file: "d70b01f1b56c285fbd2fade2e8bb8217.jpg", focus: "50% 20%" },
  { id: "ayumi-3", name: "Ayumi Yoshida (3)", file: "fe3e6dd714af7a6700be0643e8c37886.jpg", focus: "50% 20%" },
  { id: "conan-2", name: "Conan Edogawa (2)", file: "0445ac9b5d26176310b3321c822ecf11.jpg", focus: "50% 20%" },
  { id: "conan-3", name: "Conan Edogawa (3)", file: "1f228f4b9a14893b2caa81f8b727d605.jpg", focus: "50% 20%" },
  { id: "conan-4", name: "Conan Edogawa (4)", file: "2b2de53b182e4967858fd135d1cd43ff.jpg", focus: "50% 20%" },
  { id: "conan-5", name: "Conan Edogawa (5)", file: "2b86a6f7b06661880ec939ca5f268c7a.jpg", focus: "50% 20%" },
  { id: "conan-6", name: "Conan Edogawa (6)", file: "3a7611944cd2fa5437ef0f5f426f87d4.jpg", focus: "50% 20%" },
  { id: "conan-7", name: "Conan Edogawa (7)", file: "463261008aa26c229abb8320ee559687.jpg", focus: "50% 20%" },
  { id: "conan-8", name: "Conan Edogawa (8)", file: "4a3811deacbde9f078f210da9964fc92.jpg", focus: "50% 20%" },
  { id: "conan-9", name: "Conan Edogawa (9)", file: "57f348e87a954d708e5763ee5d39debb.jpg", focus: "50% 20%" },
  { id: "conan-10", name: "Conan Edogawa (10)", file: "7e4f9496cd249d88dbf642a9bf452853.jpg", focus: "50% 20%" },
  { id: "conan-11", name: "Conan Edogawa (11)", file: "857479473e43d5afe4339ebe73eb21df.jpg", focus: "50% 20%" },
  { id: "conan-12", name: "Conan Edogawa (12)", file: "947320d578796af627bd8b570b12a64b.jpg", focus: "50% 20%" },
  { id: "conan-13", name: "Conan Edogawa (13)", file: "a6025d221e2bdbe0f0c8f15bacde3a59.jpg", focus: "50% 20%" },
  { id: "conan-14", name: "Conan Edogawa (14)", file: "c300e2ed2e433addc7ec5ab833080eec.jpg", focus: "50% 20%" },
  { id: "conan-15", name: "Conan Edogawa (15)", file: "c5ad7ae1dfd688aad5550b69c6b85bab.jpg", focus: "50% 20%" },
  { id: "conan-16", name: "Conan Edogawa (16)", file: "c8576d326838d167dc89b0243b706ef3.jpg", focus: "50% 20%" },
  { id: "conan-17", name: "Conan Edogawa (17)", file: "cad901cd2081693ad7d91cda9a223b60.jpg", focus: "50% 20%" },
  { id: "conan-18", name: "Conan Edogawa (18)", file: "d47fc7010273ff174170939a94ea8f90.jpg", focus: "50% 20%" },
  { id: "conan-19", name: "Conan Edogawa (19)", file: "daf15aad61431f20cccf76ee18aae593.jpg", focus: "50% 20%" },
  { id: "conan-20", name: "Conan Edogawa (20)", file: "f1ea9d5c97ebb5a83abe515c6adb1224.jpg", focus: "50% 20%" },
  { id: "genta", name: "Genta Kojima", file: "a3d1c921323f7d2c52f67536bc89a35a.jpg", focus: "50% 20%" },
  { id: "genta-2", name: "Genta Kojima (2)", file: "f1bd588dd0f6a78352bbbd1e91ff2671.jpg", focus: "50% 20%" },
  { id: "genta-3", name: "Genta Kojima (3)", file: "fa750c34a9292005a410424a4c7abaf8.jpg", focus: "50% 20%" },
  { id: "genta-4", name: "Genta Kojima (4)", file: "faee9aac843a1e20dcca92c886e51b82.jpg", focus: "50% 20%" },
  { id: "gin-2", name: "Gin (2)", file: "49eab6a3e20023fa6e8545f798d94d17.jpg", focus: "50% 20%" },
  { id: "gin-3", name: "Gin (3)", file: "d9b1209deaaa3434a64cf5ea3c946375.jpg", focus: "50% 20%" },
  { id: "heiji-2", name: "Heiji Hattori (2)", file: "1a075b84fdd2db31a51a17c3e2929175.jpg", focus: "50% 20%" },
  { id: "heiji-3", name: "Heiji Hattori (3)", file: "a05613c59713a0189017af7156391dae.jpg", focus: "50% 20%" },
  { id: "kid-2", name: "Kaitou Kid (2)", file: "1c2ecfd27591bf1fc203bf4957a68631.jpg", focus: "50% 20%" },
  { id: "kansuke-2", name: "Kansuke Yamato (2)", file: "a8df2a6bf610d29edbc0d3f42c7deae6.jpg", focus: "50% 20%" },
  { id: "kazuha-2", name: "Kazuha Toyama (2)", file: "99f36f8e09a58030a5551dbfc1a0aaae.jpg", focus: "50% 20%" },
  { id: "masumi", name: "Masumi Sera", file: "79b4b648265bba593b86ac9b1dab869d.jpg", focus: "50% 20%" },
  { id: "agasa-2", name: "Professor Agasa (2)", file: "091b4619a77f65c47b246ee1e389ba74.jpg", focus: "50% 20%" },
  { id: "agasa-3", name: "Professor Agasa (3)", file: "60776fa203cbcb9cef51a8261845f0e7.jpg", focus: "50% 20%" },
  { id: "agasa-4", name: "Professor Agasa (4)", file: "c977217fdcbabcf8f00c34abe3e59ce9.jpg", focus: "50% 20%" },
  { id: "ran-2", name: "Ran Mouri (2)", file: "014bb7cf4f8feb243e3d7fce0b2d9721.jpg", focus: "50% 20%" },
  { id: "ran-3", name: "Ran Mouri (3)", file: "441c3ebd82ae58b1279f95ec435d03d5.jpg", focus: "50% 20%" },
  { id: "ran-4", name: "Ran Mouri (4)", file: "9a2a660fae9b50bad6392be17e4bf5ac.jpg", focus: "50% 20%" },
  { id: "ran-5", name: "Ran Mouri (5)", file: "a5613bc9b93a8d1e965cafc326f94eaf.jpg", focus: "50% 20%" },
  { id: "ran-6", name: "Ran Mouri (6)", file: "d54269acdf5fefaf0836b29fb2e401a0.jpg", focus: "50% 20%" },
  { id: "ran-7", name: "Ran Mouri (7)", file: "dafda19f5e01097f9c80a4f60b48285c.jpg", focus: "50% 20%" },
  { id: "shinichi", name: "Shinichi Kudo", file: "2df2b24108ecc1f46ece8b82223cac01.jpg", focus: "50% 20%" },
  { id: "shinichi-2", name: "Shinichi Kudo (2)", file: "344bf2ea9e4c3cf227de659e91b6a691.jpg", focus: "50% 20%" },
  { id: "shinichi-3", name: "Shinichi Kudo (3)", file: "4c13227999a2d845390aa9a769803ad9.jpg", focus: "50% 20%" },
  { id: "shinichi-4", name: "Shinichi Kudo (4)", file: "590e8c41c3b1df5a000caf6e6e90983d.jpg", focus: "50% 20%" },
  { id: "shinichi-5", name: "Shinichi Kudo (5)", file: "5e1b5145acd9b6797590dcda8e19a8f3.jpg", focus: "50% 20%" },
  { id: "shinichi-6", name: "Shinichi Kudo (6)", file: "8c91fe2be25ed6882ea0306aae2861be.jpg", focus: "50% 20%" },
  { id: "shinichi-7", name: "Shinichi Kudo (7)", file: "8cfb7a9d7b771ef19674a4f521321249.jpg", focus: "50% 20%" },
  { id: "shinichi-8", name: "Shinichi Kudo (8)", file: "948e7b0afaa32b4f62736aeda828ca32.jpg", focus: "50% 20%" },
  { id: "shinichi-9", name: "Shinichi Kudo (9)", file: "9cc444d4aa7b65171c1bc59ae4ef2fbc.jpg", focus: "50% 20%" },
  { id: "shinichi-10", name: "Shinichi Kudo (10)", file: "9e6e1d914176977cb7b7979800851559.jpg", focus: "50% 20%" },
  { id: "shinichi-11", name: "Shinichi Kudo (11)", file: "a57569757839d2a56bb875e59b7edffc.jpg", focus: "50% 20%" },
  { id: "shinichi-12", name: "Shinichi Kudo (12)", file: "a5e66721c0fe47c8a5d7336bf97ddf93.jpg", focus: "50% 20%" },
  { id: "shinichi-13", name: "Shinichi Kudo (13)", file: "af0e59fe0ae02f4b9cdd1221fb768dfe.jpg", focus: "50% 20%" },
  { id: "shinichi-14", name: "Shinichi Kudo (14)", file: "b3979a7f281b75528ca414091b95e1e0.jpg", focus: "50% 20%" },
  { id: "shinichi-15", name: "Shinichi Kudo (15)", file: "ca7a72f73c6ad7b9ed3c08173267cae4.jpg", focus: "50% 20%" },
  { id: "shinichi-16", name: "Shinichi Kudo (16)", file: "d90fbe74d4aeae35c328832f69517cfc.jpg", focus: "50% 20%" },
  { id: "shinichi-17", name: "Shinichi Kudo (17)", file: "ed8ed905afb63e60aa79bd6287b53a18.jpg", focus: "50% 20%" },
  { id: "shinichi-18", name: "Shinichi Kudo (18)", file: "f592079a026b12ede89dc44f98684f16.jpg", focus: "50% 20%" },
  { id: "shinichi-19", name: "Shinichi Kudo (19)", file: "image.jpg", focus: "50% 20%" },
  { id: "shinichi-20", name: "Shinichi Kudo (20)", file: "af0e59fe0ae02f4b9cdd1221fb768dfe (1).jpg", focus: "50% 20%" },
  { id: "akai-2", name: "Shuichi Akai (2)", file: "36b25719c4ed4e0cf134807741174390.jpg", focus: "50% 20%" },
  { id: "amuro", name: "Tooru Amuro", file: "00f8ba3fb253208e2022041ec5e4d006.jpg", focus: "50% 20%" },
  { id: "amuro-2", name: "Tooru Amuro (2)", file: "b255b80b5326133beae17fe4274c958b.jpg", focus: "50% 20%" },
  { id: "amuro-3", name: "Tooru Amuro (3)", file: "fe4a220cbedbc2a091d65b7252560658.jpg", focus: "50% 20%" },
  { id: "amuro-4", name: "Tooru Amuro (4)", file: "942397dbfcefecc9041d9977b706150a.jpg", focus: "50% 20%" },
  { id: "vermouth-2", name: "Vermouth (2)", file: "f5b9725043e6fd89c5c242f711b76e0a.jpg", focus: "50% 20%" },
  { id: "yukiko", name: "Yukiko Kudo", file: "529e14337567d1ad3d1108014036d417.jpg", focus: "50% 20%" },
  { id: "yusaku-2", name: "Yusaku Kudo (2)", file: "5400d8773b9bf8a1cfca89f4219ae178.jpg", focus: "50% 20%" },
  { id: "u-1933c5", name: "Unknown 1933C5", file: "1933c5866d7e5c40d91f7f1c89140377.jpg", focus: "50% 20%" },
  { id: "u-279a22", name: "Unknown 279A22", file: "279a22482e5684b9a0d145efb6dc3133.jpg", focus: "50% 20%" },
  { id: "u-2dbb1a", name: "Unknown 2DBB1A", file: "2dbb1af8fd0c791dfc0f0c8b77f96f28.jpg", focus: "50% 20%" },
  { id: "u-4ced68", name: "Unknown 4CED68", file: "4ced686aff30b930d358d3f71d131b7d.jpg", focus: "50% 20%" },
  { id: "u-53d2c2", name: "Unknown 53D2C2", file: "53d2c202908cb5f2430b6e0a745844cd.jpg", focus: "50% 20%" },
  { id: "u-55e9fc", name: "Unknown 55E9FC", file: "55e9fc392fa30bbd30fa57a3baf5e2ae.jpg", focus: "50% 20%" },
  { id: "u-57cc23", name: "Unknown 57CC23", file: "57cc23982a00a43e729b54ed92059ee8.jpg", focus: "50% 20%" },
  { id: "u-5f9005", name: "Unknown 5F9005", file: "5f9005b29926cff569167e00aa176f45.jpg", focus: "50% 20%" },
  { id: "u-67a200", name: "Unknown 67A200", file: "67a200385c81f17ac0cc4dd250bdd86c.jpg", focus: "50% 20%" },
  { id: "u-6c29ba", name: "Unknown 6C29BA", file: "6c29baa999c30cef7e122fd8acb06da2.jpg", focus: "50% 20%" },
  { id: "u-708502", name: "Unknown 708502", file: "70850237276fed2187d09cd1ad4f4564.jpg", focus: "50% 20%" },
  { id: "u-82110f", name: "Unknown 82110F", file: "82110f7d0e8aa4ebce7813edf87470d2.jpg", focus: "50% 20%" },
  { id: "u-917d5a", name: "Unknown 917D5A", file: "917d5a3ff858a90a030a063f3ea0fe23.jpg", focus: "50% 20%" },
  { id: "u-95daf4", name: "Unknown 95DAF4", file: "95daf4d2ec98f185832596ea58458f82.jpg", focus: "50% 20%" },
  { id: "u-9ae70c", name: "Unknown 9AE70C", file: "9ae70cc3384d90706f62e957355b3007.jpg", focus: "50% 20%" },
  { id: "u-ad190d", name: "Unknown AD190D", file: "ad190d1b3ce9e013044f96dfa7d73bd0.jpg", focus: "50% 20%" },
  { id: "u-c7096f", name: "Unknown C7096F", file: "c7096f951e9e26b8b9a58f95df70c5d5.jpg", focus: "50% 20%" },
  { id: "u-c98ac2", name: "Unknown C98AC2", file: "c98ac230a1d952cfcd3365af95ea28f3.jpg", focus: "50% 20%" },
  { id: "u-cc42ff", name: "Unknown CC42FF", file: "cc42ffd434cf0978d6878b0bbb5e34f5.jpg", focus: "50% 20%" },
  { id: "u-d62f33", name: "Unknown D62F33", file: "d62f3340c0c23da4e565840bc2c44d4d.jpg", focus: "50% 20%" },
  { id: "u-ef868e", name: "Unknown EF868E", file: "ef868ec495ec0d1df5524f3c0fb43daa.jpg", focus: "50% 20%" },
  { id: "u-fbea6c", name: "Unknown FBEA6C", file: "fbea6ca2fb3bbbeb6cef99ff1972566e.jpg", focus: "50% 20%" },
  { id: "u-image-1", name: "Unknown Image 1", file: "image (1).jpg", focus: "50% 20%" },
  { id: "u-image-2", name: "Unknown Image 2", file: "image (2).jpg", focus: "50% 20%" },
  { id: "u-image-3", name: "Unknown Image 3", file: "image (3).jpg", focus: "50% 20%" },
  { id: "u-image-4", name: "Unknown Image 4", file: "image (4).jpg", focus: "50% 20%" },
]

export const DEFAULT_BACKGROUND_ID = "conan"

export function backgroundSrc(file: string): string {
  return `/cards/${encodeURIComponent(file)}`
}

export function getBackground(id: string): WrappedBackground {
  return (
    WRAPPED_BACKGROUNDS.find((b) => b.id === id) ??
    WRAPPED_BACKGROUNDS.find((b) => b.id === DEFAULT_BACKGROUND_ID) ??
    WRAPPED_BACKGROUNDS[0]
  )
}
