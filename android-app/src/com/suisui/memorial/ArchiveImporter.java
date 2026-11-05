package com.suisui.memorial;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * 流式解压岁岁备份包。只保留 data/archive.json、manifest.json、media/*。
 * 防 Zip-Slip。archive.json 校验通过后才把 archive.tmp 换成 archive/，失败绝不覆盖旧备份。
 */
public final class ArchiveImporter {
    public interface ZipSource {
        InputStream open() throws IOException;
    }

    public interface Progress {
        void onProgress(int percent, int count);
    }

    public static final class Result {
        public final boolean ok;
        public final String error;
        public final int extracted;
        public final int mediaCount;
        public final boolean hasArchiveJson;

        public Result(boolean ok, String error, int extracted, int mediaCount, boolean hasArchiveJson) {
            this.ok = ok;
            this.error = error == null ? "" : error;
            this.extracted = extracted;
            this.mediaCount = mediaCount;
            this.hasArchiveJson = hasArchiveJson;
        }
    }

    private static final byte[] FIELD_PROFILE = new byte[] {
            '"', 'p', 'r', 'o', 'f', 'i', 'l', 'e', '"'
    };
    private static final byte[] FIELD_TREE = new byte[] {
            '"', 't', 'r', 'e', 'e', '"'
    };

    private ArchiveImporter() {}

    public static boolean isWanted(String entryName) {
        String name = normalizeEntry(entryName);
        if (name == null || name.endsWith("/")) return false;
        if ("data/archive.json".equals(name) || "manifest.json".equals(name)) return true;
        return name.startsWith("media/") && name.length() > "media/".length();
    }

    /**
     * 把 /archive/ 之后的相对路径解析到 filesDir/archive 内。
     * 必须用 canonical path 前缀挡住路径穿越。
     */
    public static File resolveArchiveFile(File filesDir, String subPath) throws IOException {
        if (filesDir == null || subPath == null) return null;
        String rel = subPath.replace('\\', '/');
        while (rel.startsWith("/")) rel = rel.substring(1);
        if (rel.length() == 0 || rel.indexOf('\0') >= 0) return null;
        String[] parts = rel.split("/");
        for (int i = 0; i < parts.length; i++) {
            if (parts[i].length() == 0 || ".".equals(parts[i]) || "..".equals(parts[i])) return null;
            if (parts[i].indexOf(':') >= 0) return null;
        }
        File archiveRoot = new File(filesDir, "archive");
        File candidate = new File(archiveRoot, rel);
        String rootCanon = archiveRoot.getCanonicalPath();
        String canon = candidate.getCanonicalPath();
        if (!canon.startsWith(rootCanon)) return null;
        if (!canon.equals(rootCanon) && !canon.startsWith(rootCanon + File.separator)) return null;
        if (!candidate.isFile()) return null;
        return candidate;
    }

    /**
     * 上次把 archive 改名为 archive.bak 后进程被杀：正式 json 不在、备份 json 还在，则恢复。
     * 已有完好的 archive/data/archive.json 时什么都不做。
     */
    public static boolean recoverInterruptedSwap(File filesDir) {
        if (filesDir == null) return false;
        File archiveJson = new File(filesDir, "archive/data/archive.json");
        File bakJson = new File(filesDir, "archive.bak/data/archive.json");
        if (archiveJson.isFile() || !bakJson.isFile()) return false;
        File archive = new File(filesDir, "archive");
        File bak = new File(filesDir, "archive.bak");
        if (archive.exists()) deleteTree(archive);
        if (archive.exists()) return false;
        if (!bak.renameTo(archive)) return false;
        deleteTree(new File(filesDir, "archive.tmp"));
        return new File(filesDir, "archive/data/archive.json").isFile();
    }

    public static Result importZip(ZipSource source, File filesDir, Progress progress) {
        if (source == null || filesDir == null) {
            return new Result(false, "无法打开所选文件", 0, 0, false);
        }
        if (!filesDir.isDirectory() && !filesDir.mkdirs()) {
            return new Result(false, "无法创建本地目录", 0, 0, false);
        }
        File tmp = new File(filesDir, "archive.tmp");
        File archive = new File(filesDir, "archive");
        File bak = new File(filesDir, "archive.bak");
        try {
            deleteTree(tmp);
            if (!tmp.mkdirs()) return new Result(false, "无法准备导入目录", 0, 0, false);
            Extracted extracted = extractWanted(source, tmp, progress);
            String invalid = archiveJsonError(tmp);
            if (invalid != null) {
                deleteTree(tmp);
                return new Result(false, invalid, extracted.count, extracted.mediaCount, extracted.hasArchiveJson);
            }
            deleteTree(bak);
            if (archive.exists()) {
                if (!archive.renameTo(bak)) {
                    deleteTree(tmp);
                    return new Result(false, "无法替换已有纪念馆数据", extracted.count, extracted.mediaCount, true);
                }
            }
            if (!tmp.renameTo(archive)) {
                if (bak.exists() && !archive.exists()) bak.renameTo(archive);
                deleteTree(tmp);
                return new Result(false, "导入完成但无法写入纪念馆目录", extracted.count, extracted.mediaCount, true);
            }
            deleteTree(bak);
            if (progress != null) progress.onProgress(100, extracted.count);
            return new Result(true, "", extracted.count, extracted.mediaCount, true);
        } catch (SlipException e) {
            deleteTree(tmp);
            return new Result(false, "备份包路径不合法，已拒绝导入", 0, 0, false);
        } catch (IOException e) {
            deleteTree(tmp);
            return new Result(false, "备份包读取失败，请再试一次", 0, 0, false);
        }
    }

    /**
     * 单遍解压。进度按已解压文件数估算，避免先整包数一遍再解压。
     */
    private static Extracted extractWanted(ZipSource source, File tmp, Progress progress) throws IOException {
        ZipInputStream zin = new ZipInputStream(new BufferedInputStream(source.open(), 65536));
        int count = 0;
        int media = 0;
        boolean hasJson = false;
        byte[] buf = new byte[65536];
        try {
            ZipEntry entry;
            while ((entry = zin.getNextEntry()) != null) {
                String rawName = entry.getName();
                if (entry.isDirectory() || (rawName != null && (rawName.endsWith("/") || rawName.endsWith("\\")))) {
                    zin.closeEntry();
                    continue;
                }
                String name = normalizeEntry(rawName);
                if (name == null) {
                    throw new SlipException(rawName);
                }
                if (!isWanted(name)) {
                    zin.closeEntry();
                    continue;
                }
                File out = safeTarget(tmp, name);
                File parent = out.getParentFile();
                if (parent != null && !parent.exists()) parent.mkdirs();
                if (parent != null && !parent.isDirectory()) {
                    throw new IOException("mkdir " + parent.getName());
                }
                BufferedOutputStream bout = new BufferedOutputStream(new FileOutputStream(out));
                try {
                    int n;
                    while ((n = zin.read(buf)) >= 0) {
                        if (n > 0) bout.write(buf, 0, n);
                    }
                } finally {
                    bout.close();
                }
                zin.closeEntry();
                count++;
                if (name.startsWith("media/")) media++;
                if ("data/archive.json".equals(name)) hasJson = true;
                if (progress != null && (count == 1 || count % 8 == 0)) {
                    progress.onProgress(Math.min(95, 10 + count / 8), count);
                }
            }
        } finally {
            zin.close();
        }
        if (progress != null && count > 0) {
            progress.onProgress(Math.min(95, 10 + count / 8), count);
        }
        Extracted result = new Extracted();
        result.count = count;
        result.mediaCount = media;
        result.hasArchiveJson = hasJson;
        return result;
    }

    /**
     * 替换正式 archive/ 之前调用。null 表示可以替换；非 null 是给用户看的错误，调用方必须删掉 tmp 且不准动旧 archive/。
     */
    static String archiveJsonError(File tmpRoot) {
        File json = new File(tmpRoot, "data/archive.json");
        if (!json.isFile() || json.length() <= 2) {
            return "备份包里的 archive.json 不完整，未覆盖已有纪念馆";
        }
        try {
            if (!startsWithObject(json) || !endsWithObject(json)) {
                return "备份包里的 archive.json 不是合法数据，未覆盖已有纪念馆";
            }
            if (!containsProfileOrTree(json)) {
                return "备份包里的 archive.json 缺少纪念馆内容，未覆盖已有纪念馆";
            }
            return null;
        } catch (IOException e) {
            return "备份包里的 archive.json 无法读取，未覆盖已有纪念馆";
        }
    }

    private static boolean startsWithObject(File json) throws IOException {
        FileInputStream in = new FileInputStream(json);
        try {
            byte[] buf = new byte[4096];
            int n = in.read(buf);
            if (n <= 0) return false;
            int i = 0;
            if (n >= 3 && (buf[0] & 0xff) == 0xEF && (buf[1] & 0xff) == 0xBB && (buf[2] & 0xff) == 0xBF) i = 3;
            while (i < n) {
                if (isJsonSpace(buf[i])) {
                    i++;
                    continue;
                }
                return buf[i] == '{';
            }
            return false;
        } finally {
            in.close();
        }
    }

    private static boolean endsWithObject(File json) throws IOException {
        long len = json.length();
        int take = (int) Math.min(4096L, len);
        if (take <= 0) return false;
        byte[] buf = new byte[take];
        FileInputStream in = new FileInputStream(json);
        try {
            long skip = len - take;
            while (skip > 0) {
                long skipped = in.skip(skip);
                if (skipped <= 0) {
                    if (in.read() < 0) return false;
                    skip--;
                    continue;
                }
                skip -= skipped;
            }
            int off = 0;
            while (off < take) {
                int r = in.read(buf, off, take - off);
                if (r < 0) break;
                off += r;
            }
            for (int i = off - 1; i >= 0; i--) {
                if (isJsonSpace(buf[i])) continue;
                return buf[i] == '}';
            }
            return false;
        } finally {
            in.close();
        }
    }

    private static boolean containsProfileOrTree(File json) throws IOException {
        int overlap = Math.max(FIELD_PROFILE.length, FIELD_TREE.length) - 1;
        FileInputStream in = new FileInputStream(json);
        try {
            byte[] buf = new byte[65536];
            byte[] window = new byte[0];
            int n;
            while ((n = in.read(buf)) >= 0) {
                if (n == 0) continue;
                byte[] chunk = new byte[window.length + n];
                System.arraycopy(window, 0, chunk, 0, window.length);
                System.arraycopy(buf, 0, chunk, window.length, n);
                if (indexOf(chunk, FIELD_PROFILE) >= 0 || indexOf(chunk, FIELD_TREE) >= 0) return true;
                if (chunk.length <= overlap) {
                    window = chunk;
                } else {
                    window = new byte[overlap];
                    System.arraycopy(chunk, chunk.length - overlap, window, 0, overlap);
                }
            }
            return false;
        } finally {
            in.close();
        }
    }

    private static boolean isJsonSpace(byte b) {
        return b == ' ' || b == '\t' || b == '\n' || b == '\r';
    }

    private static int indexOf(byte[] data, byte[] needle) {
        if (needle.length == 0 || data.length < needle.length) return -1;
        int last = data.length - needle.length;
        for (int i = 0; i <= last; i++) {
            int j = 0;
            while (j < needle.length && data[i + j] == needle[j]) j++;
            if (j == needle.length) return i;
        }
        return -1;
    }

    static File safeTarget(File destRoot, String normalizedName) throws IOException {
        File dest = new File(destRoot, normalizedName);
        String rootCanon = destRoot.getCanonicalPath();
        String destCanon = dest.getCanonicalPath();
        if (!destCanon.startsWith(rootCanon) || (!destCanon.equals(rootCanon) && !destCanon.startsWith(rootCanon + File.separator))) {
            throw new SlipException(normalizedName);
        }
        return dest;
    }

    static String normalizeEntry(String entryName) {
        if (entryName == null) return null;
        String name = entryName.replace('\\', '/');
        while (name.startsWith("/")) name = name.substring(1);
        if (name.length() == 0 || name.indexOf('\0') >= 0) return null;
        String[] parts = name.split("/");
        StringBuilder rebuilt = new StringBuilder();
        for (int i = 0; i < parts.length; i++) {
            String part = parts[i];
            if (part.length() == 0 || ".".equals(part)) continue;
            if ("..".equals(part) || part.indexOf(':') >= 0) return null;
            if (rebuilt.length() > 0) rebuilt.append('/');
            rebuilt.append(part);
        }
        if (rebuilt.length() == 0) return null;
        return rebuilt.toString();
    }

    public static void deleteTree(File file) {
        if (file == null || !file.exists()) return;
        if (file.isDirectory()) {
            File[] kids = file.listFiles();
            if (kids != null) {
                for (int i = 0; i < kids.length; i++) deleteTree(kids[i]);
            }
        }
        if (!file.delete() && file.exists()) {
            file.deleteOnExit();
        }
    }

    private static final class Extracted {
        int count;
        int mediaCount;
        boolean hasArchiveJson;
    }

    static final class SlipException extends IOException {
        SlipException(String name) {
            super(name == null ? "zip-slip" : name);
        }
    }
}
