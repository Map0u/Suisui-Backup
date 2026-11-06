import com.suisui.memorial.ArchiveImporter;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * v1.3.0 分卷合并测试：
 *  卷A（媒体卷）：只有 manifest.json(exportId) + media/* ，没有 archive.json
 *  卷B（索引卷）：manifest.json + data/archive.json
 *
 * 期望：
 *  1) 先倒卷B → 正常替换成 archives/<key>/...
 *  2) 再倒卷A → 只把 media/* 追加到激活账号目录，不动 archive.json
 *  3) 单独倒卷A（没有索引卷） → 友好报错不破坏
 */
public class MultiVolImportTest {
    private static int failures = 0;

    public static void main(String[] args) throws Exception {
        File work = new File(System.getProperty("java.io.tmpdir"), "suisui-multivol-test");
        ArchiveImporter.deleteTree(work);
        work.mkdirs();

        /* ---- 卷B：索引卷 ---- */
        File indexZip = new File(work, "index.zip");
        writeZip(indexZip, new String[][]{
                {"data/archive.json", "{\"profile\":{\"uid\":\"u_test_01\",\"nickname\":\"烛\"},\"tree\":[{\"id\":\"t1\",\"content\":\"hi\"}]}"},
                {"manifest.json", "{\"version\":3,\"exportId\":\"e1\",\"accountKey\":\"u_test_01\",\"vol\":2,\"indexVol\":true}"},
                {"岁岁记忆全文合集.txt", "文本手账"},
                {"media-urls.txt", "media/img_1.png\tmedia/img_1.png"}
        });

        /* ---- 卷A：媒体卷 ---- */
        File mediaZip = new File(work, "media.zip");
        writeZip(mediaZip, new String[][]{
                {"manifest.json", "{\"version\":3,\"exportId\":\"e1\",\"accountKey\":\"u_test_01\",\"vol\":1,\"indexVol\":false}"},
                {"media/img_1.png", "PNG_BYTES_1"},
                {"media/voice_1.wav", "WAV_BYTES"}
        });

        /* ---- 场景1：单独倒媒体卷（没有索引卷）→ 失败 ---- */
        File root = new File(work, "files");
        ArchiveImporter.deleteTree(root);
        root.mkdirs();
        ArchiveImporter.Result r1 = ArchiveImporter.importZip(sourceOf(mediaZip), root, null);
        check(!r1.ok, "media-only zip without index should fail, got ok=true");
        check(r1.error.contains("索引"), "error should mention index vol, got: " + r1.error);

        /* ---- 场景2：先倒索引卷 ---- */
        ArchiveImporter.Result r2 = ArchiveImporter.importZip(sourceOf(indexZip), root, null);
        check(r2.ok, "index vol import failed: " + r2.error);
        File arch = new File(root, "archives/u_test_01/data/archive.json");
        check(arch.isFile(), "archive.json not in archives/u_test_01");

        /* ---- 场景3：再倒媒体卷 → 只追加 media/ ---- */
        ArchiveImporter.Result r3 = ArchiveImporter.importZip(sourceOf(mediaZip), root, null);
        check(r3.ok, "media vol merge failed: " + r3.error);
        check(new File(root, "archives/u_test_01/media/img_1.png").isFile(), "media/img_1.png missing");
        check(new File(root, "archives/u_test_01/media/voice_1.wav").isFile(), "media/voice_1.wav missing");
        check(arch.isFile(), "archive.json was removed by media vol");
        check(readFile(arch).contains("烛"), "archive.json content corrupted");

        /* ---- 场景4：别的账号媒体卷倒不进当前账号 ---- */
        File otherZip = new File(work, "other.zip");
        writeZip(otherZip, new String[][]{
                {"manifest.json", "{\"version\":3,\"exportId\":\"e9\",\"accountKey\":\"u_OTHER\",\"vol\":1}"},
                {"media/hack.png", "X"}
        });
        ArchiveImporter.Result r4 = ArchiveImporter.importZip(sourceOf(otherZip), root, null);
        check(!r4.ok, "cross-account media vol should be rejected");
        check(!new File(root, "archives/u_test_01/media/hack.png").exists(), "foreign media leaked in");

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

    private static void check(boolean cond, String msg) {
        if (!cond) { System.out.println("FAIL: " + msg); failures++; }
        else System.out.println("ok: " + msg);
    }
}
