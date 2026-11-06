package com.suisui.memorial;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStreamReader;
import java.io.BufferedReader;
import java.io.PushbackReader;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Arrays;
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
        File archiveRoot = activeArchiveRoot(filesDir);
        return resolveFileInRoot(archiveRoot, rel);
    }

    public static File resolveAccountFile(File filesDir, String accountKey, String subPath) throws IOException {
        if (filesDir == null || !validAccountKey(accountKey) || subPath == null) return null;
        return resolveFileInRoot(new File(filesDir, "archives/" + accountKey), subPath);
    }

    private static File resolveFileInRoot(File archiveRoot, String rel) throws IOException {
        if (archiveRoot == null || rel == null || rel.length() == 0 || rel.indexOf('\\') >= 0 || rel.indexOf('\0') >= 0) return null;
        String[] parts = rel.split("/", -1);
        for (String part : parts) {
            if (part.length() == 0 || ".".equals(part) || "..".equals(part) || part.indexOf(':') >= 0) return null;
        }
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

    private static boolean validAccountKey(String key) {
        return key != null && key.matches("[A-Za-z0-9_-]{1,128}");
    }

    private static String readSmallFile(File file, int limit) throws IOException {
        FileInputStream in = new FileInputStream(file);
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while (out.size() < limit && (n = in.read(buf, 0, Math.min(buf.length, limit - out.size()))) > 0) {
                out.write(buf, 0, n);
            }
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        } finally {
            in.close();
        }
    }

    private static String activeKey(File filesDir) {
        try {
            String key = readSmallFile(new File(filesDir, "active_account.txt"), 256).trim();
            return validAccountKey(key) ? key : null;
        } catch (IOException e) {
            return null;
        }
    }

    public static File activeArchiveRoot(File filesDir) {
        if (filesDir == null) return null;
        String key = activeKey(filesDir);
        if (key != null) return new File(new File(filesDir, "archives"), key);
        // 旧版数据在迁移失败时仍可读取，不要因升级而丢失访问能力。
        File legacy = new File(filesDir, "archive");
        return new File(legacy, "data/archive.json").isFile() ? legacy : null;
    }

    public static synchronized boolean switchArchive(File filesDir, String accountKey) {
        if (filesDir == null || !validAccountKey(accountKey)
                || !new File(filesDir, "archives/" + accountKey + "/data/archive.json").isFile()) return false;
        File tmp = new File(filesDir, "active_account.txt.tmp");
        try {
            FileOutputStream out = new FileOutputStream(tmp);
            try {
                out.write(accountKey.getBytes(StandardCharsets.UTF_8));
                out.getFD().sync();
            } finally {
                out.close();
            }
            if (!tmp.renameTo(new File(filesDir, "active_account.txt"))) throw new IOException("pointer rename");
            return true;
        } catch (IOException e) {
            tmp.delete();
            return false;
        }
    }

    public static synchronized void clearActiveArchive(File filesDir) {
        File root = activeArchiveRoot(filesDir);
        if (root != null) deleteTree(root);
        if (root == null || !root.exists()) new File(filesDir, "active_account.txt").delete();
    }

    public static synchronized String[] listArchives(File filesDir) {
        File[] dirs = new File(filesDir, "archives").listFiles();
        if (dirs == null) return new String[0];
        java.util.ArrayList<String> keys = new java.util.ArrayList<String>();
        for (File dir : dirs) {
            if (validAccountKey(dir.getName()) && new File(dir, "data/archive.json").isFile()) keys.add(dir.getName());
        }
        String[] result = keys.toArray(new String[keys.size()]);
        Arrays.sort(result);
        return result;
    }

    // 恢复中断的逐账号替换，并尽量迁移旧版 archive/。
    public static synchronized void recoverAccounts(File filesDir) {
        recoverInterruptedSwap(filesDir);
        File root = new File(filesDir, "archives");
        if (!root.isDirectory() && !root.mkdirs()) return;
        File[] entries = root.listFiles();
        if (entries != null) for (File entry : entries) {
            String name = entry.getName();
            if (name.endsWith(".bak")) {
                String key = name.substring(0, name.length() - 4);
                if (!validAccountKey(key)) continue;
                File target = new File(root, key);
                if (!target.exists()) entry.renameTo(target);
                else deleteTree(entry);
            }
        }
        deleteTree(new File(root, ".import.tmp"));
        File legacy = new File(filesDir, "archive");
        if (new File(legacy, "data/archive.json").isFile()) {
            try {
                String key = archiveKey(legacy);
                File target = new File(root, key);
                if (!target.exists() && legacy.renameTo(target)) {
                    if (activeKey(filesDir) == null && !switchArchive(filesDir, key)) target.renameTo(legacy);
                }
            } catch (IOException ignored) { }
        }
    }

    public static final class ArchiveInfo {
        public String accountKey = "";
        public String uid = "";
        public String nickname = "";
        public String avatar = "";
        public int treeCount;
    }

    // 只提取档案的资料及树洞数量，跳过其余值，避免将大型档案整体装入内存。
    public static ArchiveInfo archiveInfo(File root) throws IOException {
        ArchiveInfo info = new ArchiveInfo();
        JsonScan json = new JsonScan(new File(root, "data/archive.json"));
        try {
            json.expect('{');
            while (json.nextMember()) {
                String key = json.string();
                json.expect(':');
                if ("profile".equals(key) && json.peek() == '{') {
                    json.expect('{');
                    while (json.nextMember()) {
                        String field = json.string();
                        json.expect(':');
                        if ("uid".equals(field) || "id".equals(field) || "nickname".equals(field) || "avatar".equals(field)) {
                            String value = json.scalar();
                            if ("uid".equals(field)) info.uid = value;
                            else if ("id".equals(field) && info.uid.length() == 0) info.uid = value;
                            else if ("nickname".equals(field)) info.nickname = value;
                            else if ("avatar".equals(field)) info.avatar = value;
                        } else json.skip(0);
                    }
                } else if ("tree".equals(key) && json.peek() == '[') {
                    json.expect('[');
                    while (json.nextElement()) { json.skip(0); info.treeCount++; }
                } else json.skip(0);
            }
        } finally { json.close(); }
        return info;
    }

    private static final class JsonScan {
        private final PushbackReader in;
        JsonScan(File file) throws IOException {
            in = new PushbackReader(new BufferedReader(new InputStreamReader(new FileInputStream(file), StandardCharsets.UTF_8)), 2);
        }
        void close() throws IOException { in.close(); }
        int next() throws IOException {
            int c;
            do { c = in.read(); } while (c == ' ' || c == '\n' || c == '\r' || c == '\t' || c == 0xfeff);
            return c;
        }
        int peek() throws IOException { int c = next(); if (c >= 0) in.unread(c); return c; }
        void expect(int expected) throws IOException { if (next() != expected) throw new IOException("invalid JSON"); }
        boolean nextMember() throws IOException {
            int c = next();
            if (c == '}') return false;
            if (c == ',') c = next();
            if (c != '"') throw new IOException("invalid object");
            in.unread(c); return true;
        }
        boolean nextElement() throws IOException {
            int c = next();
            if (c == ']') return false;
            if (c == ',') c = next();
            if (c < 0) throw new IOException("invalid array");
            in.unread(c); return true;
        }
        String string() throws IOException { return readString(true); }
        String readString(boolean keep) throws IOException {
            expect('"');
            StringBuilder s = keep ? new StringBuilder() : null;
            int c;
            while ((c = in.read()) != '"') {
                if (c < 0 || c < 32) throw new IOException("invalid string");
                if (c == '\\') {
                    c = in.read();
                    if (c == 'u') {
                        int value = 0;
                        for (int i = 0; i < 4; i++) {
                            int d = Character.digit(in.read(), 16);
                            if (d < 0) throw new IOException("invalid escape");
                            value = value * 16 + d;
                        }
                        c = value;
                    } else if (c == 'n') c = '\n';
                    else if (c == 'r') c = '\r';
                    else if (c == 't') c = '\t';
                    else if (c == 'b') c = '\b';
                    else if (c == 'f') c = '\f';
                    else if (c != '"' && c != '\\' && c != '/') throw new IOException("invalid escape");
                }
                if (keep) {
                    if (s.length() >= 16384) throw new IOException("field too long");
                    s.append((char) c);
                }
            }
            return keep ? s.toString() : "";
        }
        String scalar() throws IOException {
            if (peek() == '"') return string();
            int c = peek();
            if (c == '{' || c == '[') { skip(0); return ""; }
            StringBuilder s = new StringBuilder();
            while ((c = in.read()) >= 0 && c != ',' && c != '}' && c != ']' && !Character.isWhitespace(c)) {
                if (s.length() < 256) s.append((char)c);
            }
            if (c >= 0) in.unread(c);
            return "null".equals(s.toString()) ? "" : s.toString();
        }
        void skip(int depth) throws IOException {
            if (depth > 128) throw new IOException("JSON too deep");
            int c = peek();
            if (c == '"') { readString(false); return; }
            if (c == '{') {
                expect('{');
                while (nextMember()) { readString(false); expect(':'); skip(depth + 1); }
            } else if (c == '[') {
                expect('[');
                while (nextElement()) skip(depth + 1);
            } else {
                if (c < 0) throw new IOException("unexpected end");
                scalar();
            }
        }
    }

    private static String archiveKey(File root) throws IOException {
        File manifest = new File(root, "manifest.json");
        if (manifest.isFile()) {
            JsonScan json = new JsonScan(manifest);
            try {
                json.expect('{');
                while (json.nextMember()) {
                    String field = json.string();
                    json.expect(':');
                    if ("accountKey".equals(field)) {
                        String key = json.scalar().replaceAll("[^A-Za-z0-9_-]", "");
                        if (validAccountKey(key)) return key;
                    } else json.skip(0);
                }
            } catch (IOException ignored) {
                // 老版本 manifest 不合法时仍可从 archive.json 推断账号。
            } finally { json.close(); }
        }
        ArchiveInfo info = archiveInfo(root);
        String profileKey = info.uid.replaceAll("[^A-Za-z0-9_-]", "");
        if (validAccountKey(profileKey)) return profileKey;
        // 旧备份没有账号标识：用完整 JSON 的摘要区分，绝不把不同账号压到一个目录。
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            FileInputStream in = new FileInputStream(new File(root, "data/archive.json"));
            try {
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) != -1) digest.update(buf, 0, n);
            } finally { in.close(); }
            StringBuilder key = new StringBuilder("legacy_");
            for (byte b : digest.digest()) key.append(String.format(java.util.Locale.US, "%02x", b & 0xff));
            return key.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IOException(e);
        }
    }

    public static synchronized Result importZip(ZipSource source, File filesDir, Progress progress) {
        if (source == null || filesDir == null) {
            return new Result(false, "无法打开所选文件", 0, 0, false);
        }
        if (!filesDir.isDirectory() && !filesDir.mkdirs()) {
            return new Result(false, "无法创建本地目录", 0, 0, false);
        }
        File root = new File(filesDir, "archives");
        if (!root.isDirectory() && !root.mkdirs()) return new Result(false, "无法创建本地归档目录", 0, 0, false);
        File tmp = new File(root, ".import.tmp");
        try {
            deleteTree(tmp);
            if (!tmp.mkdirs()) return new Result(false, "无法准备导入目录", 0, 0, false);
            Extracted extracted = extractWanted(source, tmp, progress);
            /* v1.3.0 分卷合并：媒体卷没有 data/archive.json 但有 media/ + manifest.json(exportId)。
             * 这种情况不替换整账号，而是把 media/* 直接追加进当前激活账号目录，
             * manifest 里 accountKey 一致才收，防把别账号的媒体卷倒进来。 */
            if (!extracted.hasArchiveJson && extracted.mediaCount > 0) {
                Result merged = mergeMediaVolume(tmp, filesDir, extracted, progress);
                deleteTree(tmp);
                return merged;
            }
            String invalid = archiveJsonError(tmp);
            if (invalid != null) {
                deleteTree(tmp);
                return new Result(false, invalid, extracted.count, extracted.mediaCount, extracted.hasArchiveJson);
            }
            String key = archiveKey(tmp);
            File archive = new File(root, key);
            File bak = new File(root, key + ".bak");
            if (bak.exists()) {
                if (!archive.exists()) {
                    if (!bak.renameTo(archive)) throw new IOException("restore archive");
                } else {
                    deleteTree(bak);
                    if (bak.exists()) throw new IOException("remove old backup");
                }
            }
            if (archive.exists() && !archive.renameTo(bak)) {
                deleteTree(tmp);
                return new Result(false, "无法替换已有纪念馆数据", extracted.count, extracted.mediaCount, true);
            }
            if (!tmp.renameTo(archive)) {
                if (bak.exists() && !archive.exists()) bak.renameTo(archive);
                deleteTree(tmp);
                return new Result(false, "导入完成但无法写入纪念馆目录", extracted.count, extracted.mediaCount, true);
            }
            if (!switchArchive(filesDir, key)) {
                deleteTree(archive);
                if (bak.exists() && !archive.exists()) bak.renameTo(archive);
                return new Result(false, "无法切换本地纪念馆", extracted.count, extracted.mediaCount, true);
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
     * 把「只有 media/ 没有 archive.json」的分卷媒体追加到激活账号目录，不整体替换。
     * manifest.accountKey 与当前激活 key 一致（或 manifest 里 exportId 有效）才收。
     */
    private static Result mergeMediaVolume(File tmp, File filesDir, Extracted extracted, Progress progress) {
        File root = activeArchiveRoot(filesDir);
        if (root == null || !new File(root, "data/archive.json").isFile()) {
            return new Result(false, "请先导入索引卷（含纪念馆数据的那一卷），再导入媒体卷", 0, 0, false);
        }
        /* 校验账号一致：manifest.accountKey 存在则必须等于当前激活 key */
        try {
            String activeKey = activeKey(filesDir);
            File mf = new File(tmp, "manifest.json");
            if (mf.isFile()) {
                String volAccount = readJsonField(mf, "accountKey");
                if (volAccount != null && volAccount.length() > 0 && activeKey != null
                        && !volAccount.replaceAll("[^A-Za-z0-9_-]", "").equals(activeKey)) {
                    return new Result(false, "这一卷属于别的账号，不能合并进当前纪念馆", 0, 0, false);
                }
            }
        } catch (IOException ignored) { }
        /* 逐文件 move：tmp/media/* → root/media/*（不覆盖已存在同名） */
        File srcMedia = new File(tmp, "media");
        File dstMedia = new File(root, "media");
        int moved = moveTree(srcMedia, dstMedia);
        /* manifest 一并放过去便于排查 */
        File mf = new File(tmp, "manifest.json");
        if (mf.isFile()) {
            File dataDir = new File(root, "data");
            if (!dataDir.isDirectory()) dataDir.mkdirs();
            File dst = new File(dataDir, "vol-manifest-" + System.currentTimeMillis() + ".json");
            mf.renameTo(dst);
        }
        if (progress != null) progress.onProgress(100, extracted.count);
        return new Result(true, "", moved, moved, false);
    }

    private static int moveTree(File src, File dst) {
        if (src == null || !src.exists()) return 0;
        if (src.isFile()) {
            if (dst.exists()) { src.delete(); return 0; }
            File parent = dst.getParentFile();
            if (parent != null && !parent.isDirectory()) parent.mkdirs();
            if (src.renameTo(dst)) return 1;
            /* rename 失败退化拷贝 */
            try {
                FileInputStream in = new FileInputStream(src);
                FileOutputStream out = new FileOutputStream(dst);
                try {
                    byte[] buf = new byte[65536];
                    int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                    out.flush();
                } finally {
                    try { in.close(); } catch (IOException ignored) {}
                    try { out.close(); } catch (IOException ignored) {}
                }
                src.delete();
                return 1;
            } catch (IOException e) {
                return 0;
            }
        }
        int moved = 0;
        File[] kids = src.listFiles();
        if (kids != null) for (File k : kids) moved += moveTree(k, new File(dst, k.getName()));
        return moved;
    }

    private static String readJsonField(File json, String field) throws IOException {
        JsonScan scan = new JsonScan(json);
        try {
            scan.expect('{');
            while (scan.nextMember()) {
                String key = scan.string();
                scan.expect(':');
                if (field.equals(key)) return scan.scalar();
                scan.skip(0);
            }
        } finally { scan.close(); }
        return null;
    }

    /**
     * 单遍解压。进度按已解压文件数估算，避免先整包数一遍再解压。
     */
    private static Extracted extractWanted(ZipSource source, File tmp, Progress progress) throws IOException {
        ZipInputStream zin = new ZipInputStream(new BufferedInputStream(source.open(), 65536));
        int count = 0;
        int media = 0;
        boolean hasJson = false;
        long lastNotifyAt = 0L;
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
                /* 万级文件的包每个文件都回调会向主线程 post 上万个 Runnable，
                 * evaluateJavascript 洪泛导致 UI 卡死。按数量+时间双闸门节流约 98%。 */
                long now = System.currentTimeMillis();
                if (progress != null && (count == 1 || count % 25 == 0) && now - lastNotifyAt >= 120) {
                    lastNotifyAt = now;
                    progress.onProgress(Math.min(95, 10 + count / 25), count);
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
