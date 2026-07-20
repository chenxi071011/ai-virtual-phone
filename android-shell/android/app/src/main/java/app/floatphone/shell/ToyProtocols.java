package app.floatphone.shell;

import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattService;

import java.nio.charset.StandardCharsets;
import java.util.Locale;

/**
 * 蓝牙玩具协议表。
 *
 * 匹配以「服务 UUID + 可写特征 UUID」为主键——这是最可靠的判据。但有几个 16 位短 UUID
 * （尤其 0000fff0）被多家厂商共用，遇到这些就再拿广播名消歧；名字也对不上就不认，
 * 交给调用方走通用回退。硬发一条大概率无效的指令没有意义。
 *
 * 协议细节（服务/特征 UUID、广播名、指令字节格式、强度上限）来自 Buttplug 项目公开的
 * 设备协议库，BSD 3-Clause 许可：
 *   https://github.com/buttplugio/buttplug
 *   Copyright 2016-2026 Nonpolynomial Labs LLC. All rights reserved.
 * 本文件是照该协议库的事实描述另行实现的 Java 版本，非源码搬运。完整许可见 NOTICE。
 */
final class ToyProtocols {

    private ToyProtocols() {}

    /** 一条协议的匹配规则与能力。 */
    static final class Spec {
        final String id;
        final String service;     // 服务 UUID 前缀（小写）
        final String tx;          // 写特征 UUID 前缀（小写）；null = 该服务下任意可写特征
        final int maxVibe;        // 震动强度上限，level(0~1) 会被缩放到 0..maxVibe
        final String[] names;     // 广播名白名单；null = 不校验名字。名字里 * 表示前缀匹配
        final boolean nameRequired; // true = 服务撞车，必须名字也对上才认

        Spec(String id, String service, String tx, int maxVibe, String[] names, boolean nameRequired) {
            this.id = id; this.service = service; this.tx = tx;
            this.maxVibe = maxVibe; this.names = names; this.nameRequired = nameRequired;
        }
    }

    // joyhub: 148 个广播名
    private static final String[] N_JOYHUB = {
        "J-Ringstar", "J-RapidTwist2", "J-Melody", "J-Virtuoso", "J-Pathfinder3", "J-RoseLin", "J-Viele",
        "J-Pearlconch", "J-PearlconchL", "J-PetiteRose", "J-MoonHorn", "J-VibTrefoil", "J-Panther", "J-Mecha",
        "J-Lagoon", "J-Firedragon", "J-Dina", "J-Vbarbie3f", "J-CHERLY2c", "J-Pathfinder2", "J-Pathfinder",
        "J-VibRipple", "J-Verax", "J-Verax2", "J-Euphoric2", "J-ROSEBUD", "J-Morningbuds2", "J-Rhythmic4",
        "J-Virtuoso2", "J-Dyllis", "J-Flamewing", "J-VelvetRabbit", "J-VividPulse", "J-VioletVine", "J-VibSiren2",
        "J-Veemy", "J-Fabledragon", "J-Faunus", "J-VortexTongue2", "J-Torin", "J-VBarbiep", "J-Vbarbie",
        "J-Viball", "J-Vase", "J-Vortex2s", "J-Royaleye", "J-VBarbie2t", "J-Pau", "J-Petalwish3", "J-Marshal",
        "J-Piet2", "J-Vince", "J-Dallin", "J-Mace2", "J-Verax4", "J-Palmyra", "J-Maiden", "J-Viele3", "J-Xylia",
        "J-Troi", "J-Tanmouth", "J-Marcela", "J-Vita", "J-LACH", "J-Markel", "J-Pipes", "J-Vigo", "J-Petalwish2",
        "J-VortexTongue", "J-Velocity", "JOYHUB-ROSELLA2", "J-ROSELLA2", "J-VibSiren", "J-ElixirEgg", "J-Volt",
        "J-RetroGuard", "J-TrueForm", "J-TrueForm3", "J-Rhythmic2", "J-Rhythmic3", "J-Mysticolor", "J-VividWings",
        "J-Rainbow", "J-BlackBull", "J-Peacock", "J-Mariner", "J-Mace", "J-MarsLion", "J-Tarian", "J-Pul",
        "J-Euphoric", "J-Euphoric3", "J-Torrian", "J-Rayen", "J-ROSELLA3", "J-Mackay", "J-Rowdy3", "J-Rowdy",
        "J-Eclipse", "J-DukeDazzle2", "J-Scarlett", "J-Tarik", "J-UricaGuard2", "J-Viva", "J-Ryden", "J-Mars",
        "J-MarsLion2", "J-Myrna", "J-Vase2", "J-Martino", "J-Enam", "J-Viv", "J-Vivara", "J-Explorer2", "J-Derik",
        "J-Peachy", "J-Divers", "J-VioletGale", "J-Vellum", "J-Torque", "J-Mighty", "J-MowgliII", "J-Pinhead",
        "J-Victor", "J-Mirage3", "J-Maelstrom", "J-Dodge", "J-Pyt", "J-Perseus", "J-Pogo", "J-Pyro", "J-MaxSensr",
        "J-Diego", "J-RoseVore", "J-Rosethorn2", "J-Pak", "J-VeeLips", "J-Veeva2", "J-Punch", "J-RoseStar",
        "J-Vows", "J-Pixel", "J-SyncFlare", "J-AuroraII", "J-Vortus", "J-Phantom", "J-Thelma", "J-Mystor"
    };

    // galaku: 108 个广播名
    private static final String[] N_GALAKU = {
        "GX85", "GX07", "GX17", "GX21", "GX22", "GX16", "GX29", "GX23", "GX25", "GX26", "GK03", "GX39", "G321",
        "G304", "G336", "G331", "G326", "G335", "G341", "G355", "G349", "G407", "G204", "G171", "G12D", "G123",
        "G23A", "G336", "G23A", "A073", "GLMT", "G901", "G912", "G901", "G20B", "K112", "G202", "K118", "K107",
        "G203", "TXHL", "TXMM", "TXKL", "K108", "K109", "KWL2", "TFHL", "TFMM", "TFKL", "K120", "K12A", "K12C",
        "LL18", "CYX2", "RC31", "MD19", "QD48", "BGSF", "BGQS", "AX05", "DT01", "BGZY", "A531", "YXSJ", "G317",
        "G312", "G302", "G320", "G314", "G228", "G315", "G307", "K311", "G339", "G354", "G12B", "G29C", "G29D",
        "GKML", "G348", "G913", "G213", "TFF1", "G310", "K113", "G228", "G310", "TFF1", "D358", "G322", "D402",
        "G40A", "G403", "G43A", "K12B", "QCVW", "QCSW", "QCPW", "SN80", "BGCD", "AK71", "TFG1", "GK27", "GX27",
        "GK25", "AC695X_1(BLE)", "GX33", "WSXK"
    };

    // magic-motion-1: 14 个广播名
    private static final String[] N_MAGIC_MOTION_1 = {
        "Smart Mini Vibe*", "Flamingo", "Flamingo T", "Smart Bean", "Smart Bean3", "Magic Cell", "Magic Wand",
        "Fugu", "Fugu2", "Gballs2", "GBalls3", "FM-LILAC-101", "Xone", "CBT002"
    };

    // magic-motion-2: 7 个广播名
    private static final String[] N_MAGIC_MOTION_2 = {
        "Eidolon", "Lipstick", "Sword", "Curve", "Solstice X", "funwand", "CBT001"
    };

    // magic-motion-3: 1 个广播名
    private static final String[] N_MAGIC_MOTION_3 = {
        "Krush"
    };

    // magic-motion-4: 8 个广播名
    private static final String[] N_MAGIC_MOTION_4 = {
        "funone", "Magic Sundi", "Kegel Coach", "Magic Lotos", "nyx", "umi", "funkegel", "bobi2"
    };

    // wevibe: 16 个广播名
    private static final String[] N_WEVIBE = {
        "Cougar", "4 Plus", "4_Plus", "4plus", "Bloom", "classic", "Classic", "Ditto", "Gala", "Jive", "Nova",
        "Pivot", "Rave", "Sync", "Verge", "Wish"
    };

    // wevibe-8bit: 13 个广播名
    private static final String[] N_WEVIBE_8BIT = {
        "Melt", "Melt 2", "Moxie", "Vector", "Wand", "Wand 2", "Bond", "Nelson", "Nova2", "Nova_2", "Nova 2",
        "Jive 2", "Jive Lite"
    };

    // svakom-v2: 13 个广播名
    private static final String[] N_SVAKOM_V2 = {
        "116", "117", "Edeny", "118", "Viviana", "Ella NEO", "S38A", "Vick NEO", "Vick Neo", "STG05A", "QH-SJ007A",
        "Cici 2", "Emma Neo 2"
    };

    // kiiroo-v21: 17 个广播名
    private static final String[] N_KIIROO_V21 = {
        "Titan1.1", "Cliona", "Pearl2.1", "Pearl2+", "Pearl 2+", "Pearl3", "Pearl 3", "OhMiBod 4.0",
        "OhMiBod LUMEN", "OhMiBod NEX2", "OhMiBod NEX3", "OhMiBod ESCA", "OhMiBod Foxy",
        "OhMiBod Chill Panty Vibe", "OhMiBod Sphinx", "Pulse Interactive", "Fuse1.1"
    };

    // libo-vibes: 11 个广播名
    private static final String[] N_LIBO_VIBES = {
        "XiaoLu", "LuXiaoHan", "BaiHu", "Gugudai", "Yuyi", "LuWuShuang", "LiBo", "QingTing", "Huohu", "Yuyi",
        "Haima"
    };

    // prettylove: 1 个广播名
    private static final String[] N_PRETTYLOVE = {
        "Aogu BLE *"
    };

    // zalo: 3 个广播名
    private static final String[] N_ZALO = {
        "ZALO-Queen", "ZALO-King", "ZALO-Jeanne"
    };

    // leten: 4 个广播名
    private static final String[] N_LETEN = {
        "T528-LT", "F537-LT", "F520B-LT", "F520A-LT"
    };

    // mizzzee: 1 个广播名
    private static final String[] N_MIZZZEE = {
        "NFY008"
    };

    // picobong: 10 个广播名
    private static final String[] N_PICOBONG = {
        "Blow hole", "Picobong Male Toy", "Diver", "Picobong Egg", "Life guard", "Picobong Ring", "Surfer",
        "Picobong Butt Plug", "Egg driver", "Surfer_plug"
    };

    // lovedistance: 10 个广播名
    private static final String[] N_LOVEDISTANCE = {
        "REACH G", "REACH", "MAG", "SPAN", "RANGE", "ORBIT", "JOIN G", "LINK", "GRASP", "RECEIVE"
    };

    // satisfyer: 1 个广播名
    private static final String[] N_SATISFYER = {
        "SF *"
    };

    /**
     * 协议表。顺序即优先级：先匹配到的先用。
     *
     * 独占服务 UUID 的排前面（nameRequired=false，认服务就够）；
     * 共用 0000fff0 / 0000ffe0 / 00006000 的排后面，且强制要求名字也对上。
     */
    static final Spec[] TABLE = {
        // —— 独占服务，认 UUID 即可 ——
        new Spec("joyhub",        "0000ffa0", "0000ffa1", 255, N_JOYHUB,         false),
        new Spec("galaku",        "00001000", "00001001", 100, N_GALAKU,         false),
        new Spec("kiiroo-v21",    "00001900", "00001902", 100, null,             false),
        new Spec("wevibe-8bit",   "f000bb03", "f000c000",  22, N_WEVIBE_8BIT,    true),
        new Spec("wevibe",        "f000bb03", "f000c000",  15, null,             false),
        new Spec("mizzzee",       "0000eea0", "0000eea1",  68, null,             false),
        new Spec("lovedistance",  "0000ff00", "0000ff01", 121, null,             false),
        new Spec("satisfyer",     "51361500", "51361502", 100, null,             false),
        new Spec("prettylove",    "0000ffe5", "0000ffe9",   3, null,             false),

        // Magic Motion 四代共用同一组 UUID，只能靠名字分。报不出名字的退到 v1（最通用）。
        new Spec("magicmotion-2", "78667579", "78667579", 100, N_MAGIC_MOTION_2, true),
        new Spec("magicmotion-3", "78667579", "78667579",  77, N_MAGIC_MOTION_3, true),
        new Spec("magicmotion-4", "78667579", "78667579", 100, N_MAGIC_MOTION_4, true),
        new Spec("magicmotion-1", "78667579", "78667579", 100, null,             false),

        // —— 共用服务，必须名字对上 ——
        // 0000fff0 被 Lovense(旧)/ZALO/Leten/Picobong/LELO 共用，认错就是发一串无效指令
        new Spec("zalo",          "0000fff0", "0000fff1",   8, N_ZALO,           true),
        new Spec("leten",         "0000fff0", "0000fff1",  25, N_LETEN,          true),
        new Spec("picobong",      "0000fff0", "0000fff1",  10, N_PICOBONG,       true),
        // 0000ffe0 被 Svakom 多代共用；这里只认 V2 名单，用户自己那台仍走 ToyBlePlugin 的旧路径
        new Spec("svakom-v2",     "0000ffe0", "0000ffe1",  10, N_SVAKOM_V2,      true),
        // 00006000 被 Libo 与 MonsterPub 共用
        new Spec("libo",          "00006000", "00006001", 100, N_LIBO_VIBES,     true),
    };

    /** 广播名是否命中白名单（大小写不敏感，尾部 * 表示前缀匹配）。 */
    static boolean nameMatches(String[] names, String deviceName) {
        if (names == null) return true;
        if (deviceName == null) return false;
        String n = deviceName.trim().toLowerCase(Locale.ROOT);
        for (String pat : names) {
            String p = pat.trim().toLowerCase(Locale.ROOT);
            if (p.endsWith("*")) {
                if (n.startsWith(p.substring(0, p.length() - 1).trim())) return true;
            } else if (n.equals(p)) {
                return true;
            }
        }
        return false;
    }

    /** 匹配结果：协议 + 用来写指令的特征值。 */
    static final class Match {
        final Spec spec;
        final BluetoothGattCharacteristic tx;
        Match(Spec spec, BluetoothGattCharacteristic tx) { this.spec = spec; this.tx = tx; }
    }

    /** 在已发现服务的 GATT 上找匹配的协议；找不到返回 null，由调用方决定怎么兜底。 */
    static Match match(BluetoothGatt g, String deviceName) {
        if (g == null) return null;
        for (Spec spec : TABLE) {
            if (spec.nameRequired && !nameMatches(spec.names, deviceName)) continue;
            for (BluetoothGattService s : g.getServices()) {
                if (!s.getUuid().toString().toLowerCase(Locale.ROOT).startsWith(spec.service)) continue;
                for (BluetoothGattCharacteristic c : s.getCharacteristics()) {
                    if (!isWritable(c)) continue;
                    if (spec.tx != null
                            && !c.getUuid().toString().toLowerCase(Locale.ROOT).startsWith(spec.tx)) continue;
                    return new Match(spec, c);
                }
            }
        }
        return null;
    }

    static boolean isWritable(BluetoothGattCharacteristic c) {
        int p = c.getProperties();
        return (p & BluetoothGattCharacteristic.PROPERTY_WRITE) != 0
                || (p & BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0;
    }

    /**
     * 把 0~1 的强度编码成该协议的指令包。
     * level=0 就是停止——各家"停"的格式不一样（有的要发专门的停止包，有的强度写 0 会被
     * 当成非法值），所以停止也走这里统一编码，不另外维护一套。
     */
    static byte[] encodeVibrate(String protocol, double level, int maxVibe) {
        double lv = Math.max(0, Math.min(1, level));
        int v = (int) Math.round(lv * maxVibe);
        switch (protocol) {
            case "joyhub":
                // a0 03 [四路强度] aa
                return new byte[]{ (byte) 0xa0, 0x03, (byte) v, (byte) v, (byte) v, (byte) v, (byte) 0xaa };

            case "galaku":
                // 明文 [35, 90,0,0,1,49,速度,0,0,0,0] 补校验和后再过一遍厂商的混淆
                return galakuEncrypt(new int[]{ 35, 90, 0, 0, 1, 49, v, 0, 0, 0, 0 });

            case "kiiroo-v21":
                return new byte[]{ 0x01, (byte) v };

            case "wevibe": {
                // 两路速度打包进同一字节的高低半字节；全停是另一种包格式
                if (v == 0) return new byte[]{ 0x0f, 0, 0, 0, 0, 0, 0, 0 };
                int packed = (v & 0x0f) | ((v & 0x0f) << 4);
                return new byte[]{ 0x0f, 0x03, 0x00, (byte) packed, 0x00, 0x03, 0x00, 0x00 };
            }

            case "wevibe-8bit": {
                if (v == 0) return new byte[]{ 0x0f, 0, 0, 0, 0, 0, 0, 0 };
                return new byte[]{ 0x0f, 0x03, 0x00, (byte) (v + 3), (byte) (v + 3), 0x03, 0x00, 0x00 };
            }

            case "magicmotion-1":
                return new byte[]{ 0x0b, (byte) 0xff, 0x04, 0x0a, 0x32, 0x32, 0x00,
                                   0x04, 0x08, (byte) v, 0x64, 0x00 };

            case "magicmotion-3":
                return new byte[]{ 0x0b, (byte) 0xff, 0x04, 0x0a, 0x46, 0x46, 0x00,
                                   0x04, 0x08, (byte) v, 0x64, 0x00 };

            case "magicmotion-2":
                return new byte[]{ 0x10, (byte) 0xff, 0x04, 0x0a, 0x32, 0x0a, 0x00,
                                   0x04, 0x08, (byte) v, 0x64, 0x00,
                                   0x04, 0x08, (byte) v, 0x64, 0x01 };

            case "magicmotion-4":
                return new byte[]{ 0x10, (byte) 0xff, 0x04, 0x0a, 0x32, 0x32, 0x00,
                                   0x04, 0x08, (byte) v, 0x64, 0x00,
                                   0x04, 0x08, (byte) v, 0x64, 0x01 };

            case "zalo":
                // 首字节 01=运行 02=停；强度为 0 时要写 1，写 0 设备会当成非法值
                return new byte[]{ (byte) (v == 0 ? 0x02 : 0x01),
                                   (byte) (v == 0 ? 0x01 : v),
                                   (byte) (v == 0 ? 0x01 : v) };

            case "leten":
                return new byte[]{ 0x02, (byte) v };

            case "picobong":
                return new byte[]{ 0x01, (byte) (v == 0 ? 0xff : 0x01), (byte) v };

            case "lovedistance":
                return new byte[]{ (byte) 0xf3, 0x00, (byte) v };

            case "mizzzee":
                return new byte[]{ 0x69, (byte) 0x96, 0x03, 0x01, (byte) (v == 0 ? 0 : 1), (byte) v };

            case "prettylove":
                return new byte[]{ 0x00, (byte) v };

            case "satisfyer":
                // 每路强度重复 4 字节，这里按单路发
                return new byte[]{ (byte) v, (byte) v, (byte) v, (byte) v };

            case "libo":
                return new byte[]{ (byte) v };

            case "svakom-v2":
                return new byte[]{ 0x55, 0x03, 0x03, 0x00, (byte) (v == 0 ? 0 : 1), (byte) v };

            default:
                // Lovense 系是 ASCII 文本指令
                return ("Vibrate:" + v + ";").getBytes(StandardCharsets.UTF_8);
        }
    }

    // Galaku 的指令要过一层自定义混淆：密钥表按"前一个已加密字节的低 2 位"选行、按下标选列。
    private static final int[][] GALAKU_KEY_TAB = {
        { 0,  24, 152, 247, 165,  61,  13,  41,  37,  80,  68,  70 },
        { 0,  69, 110, 106, 111, 120,  32,  83,  45,  49,  46,  55 },
        { 0, 101, 120,  32,  84, 111, 121, 115,  10, 142, 157, 163 },
        { 0, 197, 214, 231, 248,  10,  50,  32, 111,  98,  13,  10 },
    };

    private static byte[] galakuEncrypt(int[] payload) {
        // 明文尾部先补一个校验和（各字节之和），再逐字节混淆
        int[] data = new int[payload.length + 1];
        int sum = 0;
        for (int i = 0; i < payload.length; i++) { data[i] = payload[i]; sum += payload[i]; }
        data[payload.length] = sum & 0xff;

        int[] enc = new int[data.length];
        enc[0] = data[0];
        for (int i = 1; i < data.length; i++) {
            int a = GALAKU_KEY_TAB[enc[i - 1] & 3][Math.min(i, GALAKU_KEY_TAB[0].length - 1)];
            enc[i] = ((a ^ data[0] ^ data[i]) + a) & 0xff;
        }
        byte[] out = new byte[enc.length];
        for (int i = 0; i < enc.length; i++) out[i] = (byte) enc[i];
        return out;
    }
}
