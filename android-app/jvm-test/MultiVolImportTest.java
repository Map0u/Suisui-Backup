import com.suisui.memorial.ArchiveImporter;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.Arrays;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * v1.3.0 分卷合并测试。
 *
 * 目标语义（R3 复现钉的就是这些，钉的是修复后的行为）：
 *  - 索引卷（含 data/archive.json）→ 落到 archives/<accountKey>/
 *  - 媒体卷（只有 manifest.json + media/*）可以先落盘：不收进激活账号前也必须能暂存，
 *    等索引卷到了再按账号合并；manifest.accountKey 对应档案存在时直接并入 archives/<key>/media/
 *  - 再导同一份索引卷是「按 id 合并」：已收的 media/* 不许被整目录替换删掉
 *  - 跨账号媒体卷（accountKey 与目标档案 uid 不一致）拒绝
 *  - 串图：同名 media 文件以「树洞 images 实际指向的那份导出」为准，后导的覆盖先到的
 */
public class MultiVolImportTest {
    private static int failures = 0;

    public static void main(String[] args) throws Exception {
        File work = new File(System.getProperty("java.io.tmpdir"), "suisui-multivol-test");
        ArchiveImporter.deleteTree(work);
        work.mkdirs();

        /* ================== 既有场景：索引 → 媒体（这条在 v1.3.0 上已绿，保留） ================== */
        File indexZip = new File(work, "index.zip");
        writeZip(indexZip, new String[][]{
                {"data/archive.json", "{\"profile\":{\"uid\":\"u_test_01\",\"nickname\":\"烛\"},\"tree\":[{\"id\":\"t1\",\"content\":\"hi\"}]}"},
                {"manifest.json", "{\"version\":3,\"exportId\":\"e1\",\"accountKey\":\"u_test_01\",\"vol\":2,\"indexVol\":true}"},
                {"岁岁记忆全文合集.txt", "文本手账"},
                {"media-urls.txt", "media/img_1.png\tmedia/img_1.png"}
        });
        File mediaZip = new File(work, "media.zip");
        writeZip(mediaZip, new String[][]{
                {"manifest.json", "{\"version\":3,\"exportId\":\"e1\",\"accountKey\":\"u_test_01\",\"vol\":1,\"indexVol\":false}"},
                {"media/img_1.png", "PNG_BYTES_1"},
                {"media/voice_1.wav", "WAV_BYTES"}
        });

        File root = new File(work, "files-baseline");
        ArchiveImporter.deleteTree(root);
        root.mkdirs();

        ArchiveImporter.Result bi = ArchiveImporter.importZip(sourceOf(indexZip), root, null);
        check(bi.ok, "baseline: index vol import should succeed, got: " + bi.error);
        ArchiveImporter.Result bm = ArchiveImporter.importZip(sourceOf(mediaZip), root, null);
        check(bm.ok, "baseline: media vol merge after index should succeed, got: " + bm.error);
        check(new File(root, "archives/u_test_01/media/img_1.png").isFile(),
                "baseline: media/img_1.png missing in archives/u_test_01");
        check(new File(root, "archives/u_test_01/media/voice_1.wav").isFile(),
                "baseline: media/voice_1.wav missing in archives/u_test_01");
        File baseArch = new File(root, "archives/u_test_01/data/archive.json");
        check(baseArch.isFile() && readFile(baseArch).contains("烛"),
                "baseline: archive.json must survive media vol merge");

        /* ================== R3a：先媒体卷、后索引卷 ==================
         * 媒体卷的 accountKey=u_test_01 与 archive.json 的 profile.uid 一致。
         * 目标：媒体卷先收下（暂存或直接落账号目录），索引卷到了以后
         * archives/u_test_01/ 里 archive.json 和两个媒体文件都在。 */
        File rootA = new File(work, "files-r3a");
        ArchiveImporter.deleteTree(rootA);
        rootA.mkdirs();

        ArchiveImporter.Result ra1 = ArchiveImporter.importZip(sourceOf(mediaZip), rootA, null);
        check(ra1.ok, "R3a: media-first import should be accepted (stage media), got: " + ra1.error);
        ArchiveImporter.Result ra2 = ArchiveImporter.importZip(sourceOf(indexZip), rootA, null);
        check(ra2.ok, "R3a: index vol after media should succeed, got: " + ra2.error);
        check(readBytes(new File(rootA, "archives/u_test_01/media/img_1.png"), "PNG_BYTES_1"),
                "R3a: archives/u_test_01/media/img_1.png must equal PNG_BYTES_1");
        check(readBytes(new File(rootA, "archives/u_test_01/media/voice_1.wav"), "WAV_BYTES"),
                "R3a: archives/u_test_01/media/voice_1.wav must equal WAV_BYTES");
        File raArch = new File(rootA, "archives/u_test_01/data/archive.json");
        check(raArch.isFile() && readFile(raArch).contains("烛"),
                "R3a: archive.json must land in archives/u_test_01/data/");

        /* ================== R3b：索引 → 媒体 → 再导同一份索引卷 ==================
         * 目标：再导索引卷是按内容/id 合并，已收的 media/* 不许被整目录替换删掉。 */
        File rootB = new File(work, "files-r3b");
        ArchiveImporter.deleteTree(rootB);
        rootB.mkdirs();

        check(ArchiveImporter.importZip(sourceOf(indexZip), rootB, null).ok,
                "R3b: first index import failed");
        check(ArchiveImporter.importZip(sourceOf(mediaZip), rootB, null).ok,
                "R3b: media merge failed");
        ArchiveImporter.Result rb3 = ArchiveImporter.importZip(sourceOf(indexZip), rootB, null);
        check(rb3.ok, "R3b: re-importing same index vol should succeed, got: " + rb3.error);
        check(readBytes(new File(rootB, "archives/u_test_01/media/img_1.png"), "PNG_BYTES_1"),
                "R3b: media/img_1.png must survive index re-import");
        check(readBytes(new File(rootB, "archives/u_test_01/media/voice_1.wav"), "WAV_BYTES"),
                "R3b: media/voice_1.wav must survive index re-import");
        File rbArch = new File(rootB, "archives/u_test_01/data/archive.json");
        check(rbArch.isFile() && readFile(rbArch).contains("烛"),
                "R3b: archive.json must still contain 烛 after re-import");

        /* ================== R3c：跨账号媒体卷仍拒绝 ==================
         * accountKey=u_OTHER 与目标档案 uid=u_test_01 不一致，不许进账号目录。 */
        File rootC = new File(work, "files-r3c");
        ArchiveImporter.deleteTree(rootC);
        rootC.mkdirs();
        check(ArchiveImporter.importZip(sourceOf(indexZip), rootC, null).ok,
                "R3c: index import failed");

        File otherZip = new File(work, "other.zip");
        writeZip(otherZip, new String[][]{
                {"manifest.json", "{\"version\":3,\"exportId\":\"e9\",\"accountKey\":\"u_OTHER\",\"vol\":1,\"indexVol\":false}"},
                {"media/hack.png", "X"}
        });
        ArchiveImporter.Result rc = ArchiveImporter.importZip(sourceOf(otherZip), rootC, null);
        check(!rc.ok, "R3c: cross-account media vol must be rejected, got ok=true");
        check(!new File(rootC, "archives/u_test_01/media/hack.png").exists(),
                "R3c: foreign media must not land in u_test_01 dir");
        check(!new File(rootC, "archives/u_OTHER").exists(),
                "R3c: foreign account dir must not be created");

        /* ================== R3d：两次导出用稳定文件名，不同内容不能串图 ==================
         * 新导出按对象路径哈希命名，A 和 B 不会共用 images_1.jpg。
         * 同名不同字节不是合法协议：后一次不能靠覆盖把 A 换成 B。 */
        File rootD = new File(work, "files-r3d");
        ArchiveImporter.deleteTree(rootD);
        rootD.mkdirs();

        File e1Index = new File(work, "e1-index.zip");
        writeZip(e1Index, new String[][]{
                {"data/archive.json", "{\"profile\":{\"uid\":\"u_test_01\",\"nickname\":\"烛\"},"
                        + "\"tree\":[{\"id\":\"t1\",\"content\":\"first\",\"images\":[\"media/img_aaaaaaaaaa.jpg\"]}]}"},
                {"manifest.json", "{\"version\":3,\"exportId\":\"e1\",\"accountKey\":\"u_test_01\",\"vol\":2,\"indexVol\":true}"}
        });
        File e1Media = new File(work, "e1-media.zip");
        writeZip(e1Media, new String[][]{
                {"manifest.json", "{\"version\":3,\"exportId\":\"e1\",\"accountKey\":\"u_test_01\",\"vol\":1,\"indexVol\":false}"},
                {"media/img_aaaaaaaaaa.jpg", "JPG_A"}
        });

        File e2Index = new File(work, "e2-index.zip");
        writeZip(e2Index, new String[][]{
                {"data/archive.json", "{\"profile\":{\"uid\":\"u_test_01\",\"nickname\":\"烛\"},"
                        + "\"tree\":[{\"id\":\"t2\",\"content\":\"second\",\"images\":[\"media/img_bbbbbbbbbb.jpg\"]},"
                        + "{\"id\":\"t1\",\"content\":\"first\",\"images\":[\"media/img_aaaaaaaaaa.jpg\"]}]}"},
                {"manifest.json", "{\"version\":3,\"exportId\":\"e2\",\"accountKey\":\"u_test_01\",\"vol\":2,\"indexVol\":true}"}
        });
        File e2Media = new File(work, "e2-media.zip");
        writeZip(e2Media, new String[][]{
                {"manifest.json", "{\"version\":3,\"exportId\":\"e2\",\"accountKey\":\"u_test_01\",\"vol\":1,\"indexVol\":false}"},
                {"media/img_bbbbbbbbbb.jpg", "JPG_B"},
                {"media/img_aaaaaaaaaa.jpg", "JPG_A_AGAIN"}
        });

        check(ArchiveImporter.importZip(sourceOf(e1Index), rootD, null).ok,
                "R3d: E1 index import failed");
        check(ArchiveImporter.importZip(sourceOf(e1Media), rootD, null).ok,
                "R3d: E1 media merge failed");
        check(ArchiveImporter.importZip(sourceOf(e2Index), rootD, null).ok,
                "R3d: E2 index import failed");
        check(ArchiveImporter.importZip(sourceOf(e2Media), rootD, null).ok,
                "R3d: E2 media merge failed");

        File imgA = new File(rootD, "archives/u_test_01/media/img_aaaaaaaaaa.jpg");
        File imgB = new File(rootD, "archives/u_test_01/media/img_bbbbbbbbbb.jpg");
        String archiveText = readFile(new File(rootD, "archives/u_test_01/data/archive.json"));
        check(readBytes(imgA, "JPG_A"),
                "R3d: photo A must stay A, got: " + (imgA.isFile() ? readFile(imgA) : "<missing>"));
        check(readBytes(imgB, "JPG_B"),
                "R3d: photo B must be present as its own file, got: " + (imgB.isFile() ? readFile(imgB) : "<missing>"));
        check(archiveText.contains("\"id\":\"t1\"") && archiveText.contains("\"id\":\"t2\""),
                "R3d: both tree items must survive merge");
        check(archiveText.contains("img_aaaaaaaaaa.jpg") && archiveText.contains("img_bbbbbbbbbb.jpg"),
                "R3d: archive.json must point at both stable media names");

        if (failures == 0) {
            System.out.println("ALL PASS: multi-volume merge works");
        } else {
            System.out.println("FAILURES: " + failures);
            System.exit(1);
        }
    }

    private static ArchiveImporter.ZipSource sourceOf(final File f) {
        return new ArchiveImporter.ZipSource() {
            @Override public InputStream open() throws java.io.IOException { return new FileInputStream(f); }
        };
    }

    private static void writeZip(File f, String[][] entries) throws Exception {
        ZipOutputStream z = new ZipOutputStream(new FileOutputStream(f));
        for (String[] e : entries) {
            z.putNextEntry(new ZipEntry(e[0]));
            z.write(e[1].getBytes("UTF-8"));
            z.closeEntry();
        }
        z.close();
    }

    private static String readFile(File f) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        FileInputStream in = new FileInputStream(f);
        byte[] buf = new byte[4096]; int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        in.close();
        return out.toString("UTF-8");
    }

    /** 文件存在且内容等于 expected 才算过。 */
    private static boolean readBytes(File f, String expected) throws Exception {
        return f.isFile() && Arrays.equals(readRaw(f), expected.getBytes("UTF-8"));
    }

    private static byte[] readRaw(File f) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        FileInputStream in = new FileInputStream(f);
        byte[] buf = new byte[4096]; int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        in.close();
        return out.toByteArray();
    }

    private static void check(boolean cond, String msg) {
        if (!cond) { System.out.println("FAIL: " + msg); failures++; }
        else System.out.println("ok: " + msg);
    }
}
