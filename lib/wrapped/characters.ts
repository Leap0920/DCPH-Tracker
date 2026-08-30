export type WrappedBackground = {
  id: string
  /** Display label in the picker */
  name: string
  /** Filename inside public/characters (spaces allowed) */
  file: string
  /** object-position for the full-bleed background */
  focus?: string
}

export const WRAPPED_BACKGROUNDS: WrappedBackground[] = [
  { id: "conan", name: "Conan Edogawa", file: "Conan Edogawa.jpg", focus: "50% 20%" },
  { id: "shinichi", name: "Shinichi Kudo", file: "Conan Edogawa Shinichi Kudo.jpg", focus: "50% 20%" },
  { id: "ran", name: "Ran Mouri", file: "Ran Mouri.jpg", focus: "50% 20%" },
  { id: "heiji", name: "Heiji Hattori", file: "Heiji Hattori.jpg", focus: "50% 20%" },
  { id: "haibara", name: "Ai Haibara (Shiho)", file: "Ai Haibara Shiho Miyano.jpg", focus: "50% 20%" },
  { id: "kid", name: "Kaitou Kid", file: "Kaitou Kid Kaito Kuroba.jpg", focus: "50% 20%" },
  { id: "amuro", name: "Tooru Amuro (Rei Furuya)", file: "Tooru Amuro Bourbon.jpg", focus: "50% 20%" },
  { id: "akai", name: "Shuichi Akai", file: "Shuichi Akai.jpg", focus: "50% 20%" },
  { id: "gin", name: "Gin", file: "Gin.jpg", focus: "50% 20%" },
  { id: "vermouth", name: "Vermouth", file: "Vermouth Chris Vineyard.jpg", focus: "50% 20%" },
  { id: "kazuha", name: "Kazuha Toyama", file: "kazuha toyama.jpg", focus: "50% 20%" },
  { id: "kogoro", name: "Kogoro Mouri", file: "Kogoro Mouri.jpg", focus: "50% 20%" },
  { id: "sonoko", name: "Sonoko Suzuki", file: "Sonoko Suzuki.jpg", focus: "50% 20%" },
  { id: "makoto", name: "Makoto Kyogoku", file: "Makoto Kyogoku.jpg", focus: "50% 20%" },
  { id: "sato", name: "Miwako Sato", file: "Officer Miwako Sato.jpg", focus: "50% 20%" },
  { id: "takagi", name: "Wataru Takagi", file: "Officer Wataru Takagi.jpg", focus: "50% 20%" },
  { id: "megure", name: "Juzo Megure", file: "Inspector Juzo Megure.jpg", focus: "50% 20%" },
  { id: "agasa", name: "Professor Agasa", file: "Hiroshi Agasa.jpg", focus: "50% 20%" },
  { id: "ayumi", name: "Ayumi Yoshida", file: "ayumi yoshida.jpg", focus: "50% 20%" },
  { id: "mitsuhiko", name: "Mitsuhiko Tsuburaya", file: "tsuburaya mitsuhiko.jpg", focus: "50% 20%" },
  { id: "genta", name: "Genta Kojima", file: "genta kojima.jpg", focus: "50% 20%" },
  { id: "matsuda", name: "Jinpei Matsuda", file: "Jinpei Matsuda.jpg", focus: "50% 20%" },
  { id: "scotch", name: "Hiromitsu Morofushi (Scotch)", file: "Hiromitsu Morofushi Scotch.jpg", focus: "50% 20%" },
  { id: "jodie", name: "Jodie Starling", file: "Jodie Starling.jpg", focus: "50% 20%" },
  { id: "james", name: "James Black", file: "James Black.jpg", focus: "50% 20%" },
  { id: "camel", name: "Andre Camel", file: "Andre Camel.jpg", focus: "50% 20%" },
  { id: "kir", name: "Kir (Rena Mizunashi)", file: "Kir Rena Mizunashi.jpg", focus: "50% 20%" },
  { id: "vodka", name: "Vodka", file: "Vodka.jpg", focus: "50% 20%" },
  { id: "chianti", name: "Chianti", file: "Chianti.jpg", focus: "50% 20%" },
  { id: "korn", name: "Korn", file: "Korn.jpg", focus: "50% 20%" },
  { id: "rum", name: "Rum", file: "Rum.jpg", focus: "50% 20%" },
  { id: "pinga", name: "Pinga", file: "Pinga.jpg", focus: "50% 20%" },
  { id: "irish", name: "Irish", file: "Irish.jpg", focus: "50% 20%" },
  { id: "karasuma", name: "Renya Karasuma", file: "Renya Karasuma.jpg", focus: "50% 20%" },
  { id: "masumi", name: "Masumi Sera", file: "Masumi Sera.jpg", focus: "50% 20%" },
  { id: "mary", name: "Mary Sera", file: "Mary Sera.jpg", focus: "50% 20%" },
  { id: "shukichi", name: "Shukichi Haneda", file: "Shukichi Haneda.jpg", focus: "50% 20%" },
  { id: "tsutomu-akai", name: "Tsutomu Akai", file: "Tsutomu Akai.jpg", focus: "50% 20%" },
  { id: "akemi", name: "Akemi Miyano", file: "Akemi Miyano.jpg", focus: "50% 20%" },
  { id: "elena", name: "Elena Miyano", file: "Elena Miyano.jpg", focus: "50% 20%" },
  { id: "atsushi", name: "Atsushi Miyano", file: "Atsushi Miyano.jpg", focus: "50% 20%" },
  { id: "yusaku", name: "Yusaku Kudo", file: "yusakukudo.jpg", focus: "50% 20%" },
  { id: "yukiko", name: "Yukiko Kudo", file: "Yukikokudo.jpg", focus: "50% 20%" },
  { id: "eri", name: "Eri Kisaki", file: "Eri Kisaki.jpg", focus: "50% 20%" },
  { id: "aoko", name: "Aoko Nakamori", file: "Aoko Nakamori.jpg", focus: "50% 20%" },
  { id: "hakuba", name: "Saguru Hakuba", file: "Saguru Hakuba.jpg", focus: "50% 20%" },
  { id: "toichi", name: "Toichi Kuroba", file: "Toichi Kuroba.jpg", focus: "50% 20%" },
  { id: "chikage", name: "Chikage Kuroba", file: "Chikage Kuroba.jpg", focus: "50% 20%" },
  { id: "jii", name: "Konosuke Jii", file: "Jii Konosuke.jpg", focus: "50% 20%" },
  { id: "ginzo", name: "Ginzo Nakamori", file: "Inspector Ginzo Nakamori.jpg", focus: "50% 20%" },
  { id: "kansuke", name: "Kansuke Yamato", file: "Kansuke yamato.jpg", focus: "50% 20%" },
  { id: "yui-uehara", name: "Yui Uehara", file: "Yui Uehara.jpg", focus: "50% 20%" },
  { id: "kuroda", name: "Hyoue Kuroda", file: "Hyoue Kuroda.jpg", focus: "50% 20%" },
  { id: "shiratori", name: "Ninzaburo Shiratori", file: "Ninzaburo Shiratori.jpg", focus: "50% 20%" },
  { id: "chiba", name: "Kazunobu Chiba", file: "Kazunobu Chiba.jpg", focus: "50% 20%" },
  { id: "yumi", name: "Yumi Miyamoto", file: "Yumi Miyamoto.jpg", focus: "50% 20%" },
  { id: "naeko", name: "Naeko Miike", file: "Naeko Miike.jpg", focus: "50% 20%" },
  { id: "ayanokoji", name: "Fumimaro Ayanokoji", file: "Fumimaro Ayanokoji.jpg", focus: "50% 20%" },
  { id: "shizuka-hattori", name: "Shizuka Hattori", file: "shizuka hattori.jpg", focus: "50% 20%" },
  { id: "heizo", name: "Heizo Hattori", file: "Heizo Hattori.jpg", focus: "50% 20%" },
  { id: "ginshiro", name: "Ginshiro Toyama", file: "Ginshiro Toyama.jpg", focus: "50% 20%" },
  { id: "otaki", name: "Goro Otaki", file: "Goro otaki.jpg", focus: "50% 20%" },
  { id: "momiji", name: "Momiji Ooka", file: "Ooka Mimoji.jpg", focus: "50% 20%" },
  { id: "muga-iori", name: "Muga Iori", file: "Iori Muga.jpg", focus: "50% 20%" },
  { id: "soshi-okita", name: "Soshi Okita", file: "Okita Soshi.jpg", focus: "50% 20%" },
  { id: "rumi-wakasa", name: "Rumi Wakasa", file: "Rumi Wakasa.jpg", focus: "50% 20%" },
  { id: "asaka", name: "Asaka", file: "Asaka.jpg", focus: "50% 20%" },
  { id: "wakita", name: "Kanenori Wakita", file: "Kanenori Wakita.jpg", focus: "50% 20%" },
  { id: "kohji-haneda", name: "Kohji Haneda", file: "Kohji Haneda.jpg", focus: "50% 20%" },
  { id: "amanda-hughes", name: "Amanda Hughes", file: "Amanda Hughes.png", focus: "50% 20%" },
  { id: "azusa", name: "Azusa Enomoto", file: "Enomoto Azusa.jpg", focus: "50% 20%" },
  { id: "eisuke", name: "Eisuke Hondo", file: "Hondo Eisuke.jpg", focus: "50% 20%" },
  { id: "jirokichi", name: "Jirokichi Suzuki", file: "Jirokichi Suzuki.jpg", focus: "50% 20%" },
  { id: "shiro-suzuki", name: "Shiro Suzuki", file: "Shiro Suzuki.jpg", focus: "50% 20%" },
  { id: "tomoko-suzuki", name: "Tomoko Suzuki", file: "Tomoko Suzuki.jpg", focus: "50% 20%" },
  { id: "ayako-suzuki", name: "Ayako Suzuki", file: "Ayako Suzuki.jpg", focus: "50% 20%" },
  { id: "yoko-okino", name: "Yoko Okino", file: "Yoko Okino.jpg", focus: "50% 20%" },
  { id: "hideo-akagi", name: "Hideo Akagi", file: "Hideo Akagi.jpg", focus: "50% 20%" },
  { id: "ryusuke-higo", name: "Ryusuke Higo", file: "‏Ryusuke Higo.jpg", focus: "50% 20%" },
  { id: "araide", name: "Dr. Tomoaki Araide", file: "Tomoaki Araide.jpg", focus: "50% 20%" },
  { id: "kobayashi", name: "Sumiko Kobayashi", file: "Sumiko Kobayashi.jpg", focus: "50% 20%" },
  { id: "yamamura", name: "Misao Yamamura", file: "Misao yamamura.jpg", focus: "50% 20%" },
  { id: "sango-yokomizo", name: "Sango Yokomizo", file: "Sango Yokomizo.jpg", focus: "50% 20%" },
  { id: "jugo-yokomizo", name: "Jugo Yokomizo", file: "Jugo Yokomizo.jpg", focus: "50% 20%" },
  { id: "matsumoto", name: "Kiyonaga Matsumoto", file: "Kiyonaga Matsumoto.jpg", focus: "50% 20%" },
  { id: "chaki", name: "Shintaro Chaki", file: "Shintaro Chaki.jpg", focus: "50% 20%" },
  { id: "calvados", name: "Calvados", file: "Calvados.jpg", focus: "50% 20%" },
  { id: "tequila", name: "Tequila", file: "Tequila.jpg", focus: "50% 20%" },
  { id: "detective-kurumazaki", name: "Detective Kurumazaki", file: "Detective Kurumazaki.jpg" },
  { id: "detective-tamura", name: "Detective Tamura", file: "Detective Tamura.jpg" },
  { id: "kyohei-nishimura", name: "Kyohei Nishimura", file: "Kyohei Nishimura.jpg" },
  { id: "misae-yamamura", name: "Misae Yamamura", file: "Misae Yamamura.jpg" },
  { id: "shoji-terabayashi", name: "Shoji Terabayashi", file: "Shoji Terabayashi.jpg" },
  { id: "tamekichi-matsushiro", name: "Tamekichi Matsushiro", file: "Tamekichi Matsushiro.jpg" },
  { id: "tsuyoshi-shikatsuno", name: "Tsuyoshi Shikatsuno", file: "Tsuyoshi Shikatsuno.png" },
  { id: "yuzo-tomizawa", name: "Yuzo Tomizawa", file: "Yuzo Tomizawa.jpg" },
]

export const DEFAULT_BACKGROUND_ID = "conan"

export function backgroundSrc(file: string): string {
  return `/characters/${encodeURIComponent(file)}`
}

export function getBackground(id: string): WrappedBackground {
  return (
    WRAPPED_BACKGROUNDS.find((b) => b.id === id) ??
    WRAPPED_BACKGROUNDS.find((b) => b.id === DEFAULT_BACKGROUND_ID) ??
    WRAPPED_BACKGROUNDS[0]
  )
}
