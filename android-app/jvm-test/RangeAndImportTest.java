import com.suisui.memorial.ArchiveImporter;
import com.suisui.memorial.ByteRange;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.Arrays;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * 直接调用解压与 Range 核心逻辑。用法：java RangeAndImportTest <backup.zip> [workDir]
 */
public class RangeAndImportTest {
    public static void main(String[] args) throws Exception {
        if (args.length < 1) {
            System.err.println("usage: RangeAndImportTest <backup.zip> [workDir]");
            System.exit(2);
        }
        File zip = new File(args[0]);
        if (!zip.isFile()) {
            fail("zip missing: " + zip.getAbsolutePath());
        }
        File work = args.length > 1
                ? new File(args[1])
                : new File(System.getProperty("java.io.tmpdir"), "suisui-core-test");
        ArchiveImporter.deleteTree(work);
        if (!work.mkdirs() && !work.isDirectory()) fail("cannot mkdir " + work);

        System.out.println("zip=" + zip.getAbsolutePath());
        System.out.println("zipBytes=" + zip.length());
        long t0 = System.currentTimeMillis();
        final File zipFile = zip;
        ArchiveImporter.Result result = ArchiveImporter.importZip(new ArchiveImporter.ZipSource() {
            @Override
            public InputStream open() throws java.io.IOException {
                return new FileInputStream(zipFile);
            }
        }, work, new ArchiveImporter.Progress() {
            int last = -1;
            @Override
            public void onProgress(int percent, int count) {
                if (percent == 100 || percent - last >= 20) {
                    System.out.println("progress pct=" + percent + " count=" + count);
                    last = percent;
                }
            }
        });
        long elapsed = System.currentTimeMillis() - t0;
        System.out.println("import ok=" + result.ok + " extracted=" + result.extracted
                + " media=" + result.mediaCount + " hasJson=" + result.hasArchiveJson
                + " error=" + result.error + " ms=" + elapsed);
        if (!result.ok) fail("import failed: " + result.error);

        File archiveJson = new File(work, "archive/data/archive.json");
        if (!archiveJson.isFile() || archiveJson.length() < 1000) fail("archive.json missing or tiny");
        byte[] head = readPrefix(archiveJson, 1);
        if (head.length != 1 || head[0] != '{') fail("archive.json does not start with {");
        File skippedHtml = new File(work, "archive/打开岁岁纪念馆.html");
        if (skippedHtml.exists()) fail("should not extract standalone html");
        File skippedTxt = new File(work, "archive/岁岁记忆全文合集.txt");
        if (skippedTxt.exists()) fail("should not extract txt hand-account");
        File manifest = new File(work, "archive/manifest.json");
        if (!manifest.isFile()) fail("manifest.json missing");

        File wav = findWav(new File(work, "archive/media"));
        if (wav == null) fail("no wav under media/");
        System.out.println("wav=" + wav.getName() + " bytes=" + wav.length());

        ByteRange.Response partial = ByteRange.open(wav, "bytes=0-1023", "audio/wav");
        byte[] body = readAll(partial.body);
        partial.body.close();
        byte[] expect = readPrefix(wav, 1024);
        System.out.println("range status=" + partial.status + " reason=" + partial.reason
                + " contentRange=" + partial.headers.get("Content-Range")
                + " length=" + partial.headers.get("Content-Length")
                + " accept=" + partial.headers.get("Accept-Ranges")
                + " acao=" + partial.headers.get("Access-Control-Allow-Origin")
                + " body=" + body.length);
        if (partial.status != 206) fail("expected 206, got " + partial.status);
        if (!"Partial Content".equals(partial.reason)) fail("reason " + partial.reason);
        if (!("bytes 0-1023/" + wav.length()).equals(partial.headers.get("Content-Range"))) {
            fail("Content-Range " + partial.headers.get("Content-Range"));
        }
        if (!"1024".equals(partial.headers.get("Content-Length"))) fail("Content-Length");
        if (!"bytes".equals(partial.headers.get("Accept-Ranges"))) fail("Accept-Ranges missing on 206");
        if (!"*".equals(partial.headers.get("Access-Control-Allow-Origin"))) fail("CORS");
        if (!Arrays.equals(expect, body)) fail("partial body mismatch");

        ByteRange.Response full = ByteRange.open(wav, null, "audio/wav");
        if (full.status != 200) fail("no-range status " + full.status);
        if (!"bytes".equals(full.headers.get("Accept-Ranges"))) fail("Accept-Ranges missing on 200");
        if (full.headers.containsKey("Content-Range")) fail("200 should not send Content-Range");
        if (!Long.toString(wav.length()).equals(full.headers.get("Content-Length"))) fail("200 Content-Length");
        full.body.close();

        ByteRange.Response openEnd = ByteRange.open(wav, "bytes=0-", "audio/wav");
        if (openEnd.status != 206) fail("open-ended range");
        if (!("bytes 0-" + (wav.length() - 1) + "/" + wav.length()).equals(openEnd.headers.get("Content-Range"))) {
            fail("open-ended Content-Range " + openEnd.headers.get("Content-Range"));
        }
        openEnd.body.close();

        if (ArchiveImporter.resolveArchiveFile(work, "../etc/passwd") != null) fail("traversal ../ not rejected");
        if (ArchiveImporter.resolveArchiveFile(work, "media/../../outside.txt") != null) fail("nested traversal not rejected");
        File resolved = ArchiveImporter.resolveArchiveFile(work, "data/archive.json");
        if (resolved == null || !resolved.getCanonicalPath().equals(archiveJson.getCanonicalPath())) {
            fail("legitimate archive path rejected");
        }

        File slipZip = new File(work, "slip.zip");
        ZipOutputStream zos = new ZipOutputStream(new FileOutputStream(slipZip));
        zos.putNextEntry(new ZipEntry("../pwned.txt"));
        zos.write("nope".getBytes("UTF-8"));
        zos.closeEntry();
        zos.putNextEntry(new ZipEntry("media/../../pwned2.txt"));
        zos.write("nope".getBytes("UTF-8"));
        zos.closeEntry();
        zos.close();
        File slipWork = new File(work, "slip-home");
        slipWork.mkdirs();
        final File slipFile = slipZip;
        ArchiveImporter.Result slip = ArchiveImporter.importZip(new ArchiveImporter.ZipSource() {
            @Override
            public InputStream open() throws java.io.IOException {
                return new FileInputStream(slipFile);
            }
        }, slipWork, null);
        if (slip.ok) fail("zip-slip import should fail");
        if (new File(slipWork, "pwned.txt").exists() || new File(work, "pwned.txt").exists()
                || new File(slipWork, "pwned2.txt").exists()) {
            fail("zip-slip wrote outside archive");
        }
        if (new File(slipWork, "archive").exists()) fail("failed slip import should not swap archive");
        System.out.println("zip-slip rejected: " + slip.error);
        System.out.println("PASS");
    }

    private static File findWav(File dir) {
        if (dir == null || !dir.isDirectory()) return null;
        File[] kids = dir.listFiles();
        if (kids == null) return null;
        File found = null;
        for (int i = 0; i < kids.length; i++) {
            File f = kids[i];
            if (f.isDirectory()) {
                File nested = findWav(f);
                if (nested != null && (found == null || nested.getName().compareTo(found.getName()) < 0)) found = nested;
            } else if (f.getName().toLowerCase().endsWith(".wav")) {
                if (found == null || f.getName().compareTo(found.getName()) < 0) found = f;
            }
        }
        return found;
    }

    private static byte[] readAll(InputStream in) throws java.io.IOException {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        int n;
        while ((n = in.read(buf)) >= 0) bos.write(buf, 0, n);
        return bos.toByteArray();
    }

    private static byte[] readPrefix(File file, int n) throws java.io.IOException {
        FileInputStream in = new FileInputStream(file);
        try {
            byte[] buf = new byte[n];
            int off = 0;
            while (off < n) {
                int r = in.read(buf, off, n - off);
                if (r < 0) break;
                off += r;
            }
            if (off == n) return buf;
            byte[] cut = new byte[off];
            System.arraycopy(buf, 0, cut, 0, off);
            return cut;
        } finally {
            in.close();
        }
    }

    private static void fail(String msg) {
        System.err.println("FAIL " + msg);
        System.exit(1);
    }
}
