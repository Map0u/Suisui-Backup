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
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
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
            /* Windows 上 renameTo 对已存在目标返回 false，用 Files.move REPLACE_EXISTING */
            Files.move(tmp.toPath(), new File(filesDir, "active_account.txt").toPath(),
                    StandardCopyOption.REPLACE_EXISTING);
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
                        String key = json.scalar().replaceAll("[^A-Za-z0-9_-]", "_");
                        if (validAccountKey(key)) return key;
                    } else json.skip(0);
                }
            } catch (IOException ignored) {
                // 老版本 manifest 不合法时仍可从 archive.json 推断账号。
            } finally { json.close(); }
        }
        ArchiveInfo info = archiveInfo(root);
        String profileKey = info.uid.replaceAll("[^A-Za-z0-9_-]", "_");
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
            /* v1.3.0 分卷合并：媒体卷没有 data/archive.json 但有 media/ + manifest.json。
             * 这种情况不替换整账号，而是把 media/* 追加进 manifest.accountKey 指向的账号目录
             *（目录不存在就先建出来，允许媒体卷先于索引卷到达）。 */
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
            if (archive.exists()) {
                /* 同账号二次导索引卷：archive.json 按 id 合并，media/* 追加（同名不覆盖），
                 * 不再整目录替换，已收的媒体卷不会被抹掉。 */
                try {
                    File mergedJson = new File(archive, "data/archive.json.new");
                    mergeArchiveJson(new File(archive, "data/archive.json"),
                            new File(tmp, "data/archive.json"), mergedJson);
                    int moved = moveTree(new File(tmp, "media"), new File(archive, "media"));
                    File mf = new File(tmp, "manifest.json");
                    if (mf.isFile()) {
                        File dst = new File(archive, "data/vol-manifest-" + System.currentTimeMillis() + ".json");
                        if (!mf.renameTo(dst)) mf.delete();
                    }
                    deleteTree(tmp);
                    if (!switchArchive(filesDir, key)) {
                        return new Result(false, "无法切换本地纪念馆", extracted.count, moved, true);
                    }
                    if (progress != null) progress.onProgress(100, extracted.count);
                    return new Result(true, "", extracted.count, moved, true);
                } catch (IOException e) {
                    deleteTree(tmp);
                    return new Result(false, "备份包读取失败，请再试一次", 0, 0, false);
                }
            }
            if (!tmp.renameTo(archive)) {
                deleteTree(tmp);
                return new Result(false, "导入完成但无法写入纪念馆目录", extracted.count, extracted.mediaCount, true);
            }
            if (!switchArchive(filesDir, key)) {
                deleteTree(archive);
                return new Result(false, "无法切换本地纪念馆", extracted.count, extracted.mediaCount, true);
            }
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
     * 把「只有 media/ 没有 archive.json」的分卷媒体追加到 archives/<accountKey>，不整体替换。
     * manifest.accountKey 必填；目标档案已有 archive.json 时校验账号 uid 一致，防跨账号倒进。
     * 目标目录可以不存在（媒体卷先于索引卷到达）——先落盘，索引卷到了再补齐 archive.json。
     */
    private static Result mergeMediaVolume(File tmp, File filesDir, Extracted extracted, Progress progress) {
        File mf = new File(tmp, "manifest.json");
        String volAccount;
        try {
            volAccount = mf.isFile() ? readJsonField(mf, "accountKey") : null;
        } catch (IOException e) {
            volAccount = null;
        }
        String accountKey = volAccount == null ? "" : volAccount.replaceAll("[^A-Za-z0-9_-]", "_");
        if (!validAccountKey(accountKey)) {
            return new Result(false, "媒体卷缺少账号标识，无法合并", 0, 0, false);
        }
        File root = new File(filesDir, "archives/" + accountKey);
        File json = new File(root, "data/archive.json");
        if (json.isFile()) {
            /* 目标档案已有索引：profile.uid 与 manifest.accountKey 规范化后一致才收 */
            try {
                String uid = readProfileUid(json);
                if (uid == null || uid.length() == 0) {
                    return new Result(false, "媒体卷与已有纪念馆账号不一致，已拒绝合并", 0, 0, false);
                }
                if (!accountKey.equals(uid.replaceAll("[^A-Za-z0-9_-]", "_"))) {
                    return new Result(false, "这一卷属于别的账号，不能合并进该纪念馆", 0, 0, false);
                }
            } catch (IOException e) {
                return new Result(false, "已有纪念馆数据读取失败，未合并媒体卷", 0, 0, false);
            }
        } else if (root.exists()) {
            /* 同账号已暂存的媒体目录（archive.json 还没到）：继续追加 */
        } else {
            /* 目标账号目录不存在：只允许「设备上还没有任何账号档案」时暂存媒体卷。
             * 已有别的账号档案时，不认识的 accountKey 一律拒绝——新账号只能由索引卷引入。 */
            File[] dirs = new File(filesDir, "archives").listFiles();
            if (dirs != null) for (File d : dirs) {
                if (validAccountKey(d.getName()) && new File(d, "data/archive.json").isFile()) {
                    return new Result(false, "这一卷属于别的账号，不能合并进当前纪念馆", 0, 0, false);
                }
            }
            if (!root.mkdirs()) return new Result(false, "无法创建本地归档目录", 0, 0, false);
        }
        /* 逐文件 move：tmp/media/* → root/media/*（不覆盖已存在同名） */
        int moved = moveTree(new File(tmp, "media"), new File(root, "media"));
        /* manifest 一并放过去便于排查 */
        if (mf.isFile()) {
            File dataDir = new File(root, "data");
            if (!dataDir.isDirectory()) dataDir.mkdirs();
            File dst = new File(dataDir, "vol-manifest-" + System.currentTimeMillis() + ".json");
            if (!mf.renameTo(dst)) mf.delete();
        }
        if (progress != null) progress.onProgress(100, extracted.count);
        return new Result(true, "", moved, moved, false);
    }

    /* ================== 同账号索引卷合并 ================== */

    /** 按 id 做并集的数组字段（导出协议约定）。 */
    private static final String[] MERGE_ARRAY_FIELDS = {
            "tree", "moods", "diaries", "post.inbox", "post.replied",
            "museum.future", "fm", "friends", "letters_in", "letters_reply", "letters_future"
    };

    /**
     * 同账号二次导索引卷：existing 与 incoming 两份 archive.json 合并后原子写 outJson。
     * 已知数组字段按 id 并集（comments/subComments 递归按评论 id 合并），
     * profile 以 incoming 为准（incoming 缺 uid/nickname 时保留 existing），
     * 其余字段以 incoming 为准、缺省保留 existing。
     */
    static void mergeArchiveJson(File existingJson, File incomingJson, File outJson) throws IOException {
        Object incomingObj = MiniJson.parse(readAll(incomingJson));
        if (!(incomingObj instanceof Map)) throw new IOException("archive.json not an object");
        /* existing 可以不存在：媒体卷先到时账号目录已建但只有 media/ 和暂存 manifest，
         * 这时合并等价于直接收下 incoming。 */
        Object existingObj = existingJson.isFile() ? MiniJson.parse(readAll(existingJson)) : null;
        @SuppressWarnings("unchecked")
        Map<String, Object> existing = existingObj instanceof Map
                ? (Map<String, Object>) existingObj : new LinkedHashMap<String, Object>();
        @SuppressWarnings("unchecked")
        Map<String, Object> incoming = (Map<String, Object>) incomingObj;

        for (String field : MERGE_ARRAY_FIELDS) {
            List<Object> merged = mergeEntryList(asList(existing.get(field)), asList(incoming.get(field)));
            if (merged != null) existing.put(field, merged);
        }

        Object incProfile = incoming.get("profile");
        if (incProfile instanceof Map) {
            @SuppressWarnings("unchecked")
            Map<String, Object> p = (Map<String, Object>) incProfile;
            boolean empty = p.get("uid") == null && p.get("nickname") == null;
            if (!empty) existing.put("profile", incProfile);
        } else if (incProfile != null) {
            existing.put("profile", incProfile);
        }

        for (Map.Entry<String, Object> e : incoming.entrySet()) {
            String key = e.getKey();
            if (isMergeArrayField(key) || "profile".equals(key)) continue;
            existing.put(key, e.getValue());
        }

        byte[] bytes = MiniJson.stringify(existing).getBytes(StandardCharsets.UTF_8);
        File parent = outJson.getParentFile();
        if (parent != null && !parent.isDirectory() && !parent.mkdirs()) {
            throw new IOException("mkdir data");
        }
        File tmp = new File(parent, outJson.getName() + ".tmp");
        FileOutputStream out = new FileOutputStream(tmp);
        try {
            out.write(bytes);
            out.getFD().sync();
        } finally {
            out.close();
        }
        try {
            Files.move(tmp.toPath(), outJson.toPath(), StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException e) {
            if (!tmp.renameTo(outJson)) {
                tmp.delete();
                throw e;
            }
        }
        /* outJson 是 *.new 的话还需要落成正式 archive.json */
        File target = new File(existingJson.getParentFile(), "archive.json");
        if (!outJson.getCanonicalPath().equals(target.getCanonicalPath())) {
            Files.move(outJson.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING);
        }
    }

    private static boolean isMergeArrayField(String key) {
        for (String f : MERGE_ARRAY_FIELDS) if (f.equals(key)) return true;
        return false;
    }

    @SuppressWarnings("unchecked")
    private static List<Object> asList(Object value) {
        return value instanceof List ? (List<Object>) value : null;
    }

    private static String entryId(Object item) {
        if (!(item instanceof Map)) return null;
        Object id = ((Map<?, ?>) item).get("id");
        return id == null ? "" : String.valueOf(id);
    }

    /** existing 为底，incoming 里 id 未见的追加；同 id 时递归合并 comments/subComments。 */
    private static List<Object> mergeEntryList(List<Object> existing, List<Object> incoming) {
        if (existing == null && incoming == null) return null;
        if (existing == null) return incoming;
        if (incoming == null) return existing;
        List<Object> result = new ArrayList<Object>(existing);
        Map<String, Integer> pos = new LinkedHashMap<String, Integer>();
        for (int i = 0; i < result.size(); i++) {
            String id = entryId(result.get(i));
            if (id != null) pos.put(id, i);
        }
        for (Object inItem : incoming) {
            String id = entryId(inItem);
            Integer at = id == null ? null : pos.get(id);
            if (at == null) {
                if (id != null) pos.put(id, result.size());
                result.add(inItem);
            } else {
                result.set(at, mergeEntry(result.get(at), inItem));
            }
        }
        return result;
    }

    /** 同 id 条目合并：以 existing 为底，comments/subComments 按评论 id 递归并集。 */
    private static Object mergeEntry(Object ex, Object in) {
        if (!(ex instanceof Map) || !(in instanceof Map)) return ex;
        @SuppressWarnings("unchecked")
        Map<String, Object> a = (Map<String, Object>) ex;
        @SuppressWarnings("unchecked")
        Map<String, Object> b = (Map<String, Object>) in;
        mergeCommentField(a, b, "comments");
        mergeCommentField(a, b, "subComments");
        return a;
    }

    private static void mergeCommentField(Map<String, Object> ex, Map<String, Object> in, String key) {
        List<Object> merged = mergeCommentList(asList(ex.get(key)), asList(in.get(key)));
        if (merged != null) ex.put(key, merged);
    }

    /** 评论列表按 id 并集，同 id 递归合并其 comments/subComments。 */
    private static List<Object> mergeCommentList(List<Object> existing, List<Object> incoming) {
        return mergeEntryList(existing, incoming);
    }

    private static String readAll(File file) throws IOException {
        FileInputStream in = new FileInputStream(file);
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) >= 0) out.write(buf, 0, n);
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        } finally {
            in.close();
        }
    }

    /** 读 archive.json 的 profile.uid（顶层 profile 对象里的 uid 字段）。 */
    private static String readProfileUid(File json) throws IOException {
        JsonScan scan = new JsonScan(json);
        try {
            scan.expect('{');
            while (scan.nextMember()) {
                String key = scan.string();
                scan.expect(':');
                if ("profile".equals(key) && scan.peek() == '{') {
                    scan.expect('{');
                    String uid = "";
                    while (scan.nextMember()) {
                        String field = scan.string();
                        scan.expect(':');
                        if ("uid".equals(field) || "id".equals(field)) {
                            String v = scan.scalar();
                            if (uid.length() == 0) uid = v;
                        } else {
                            scan.skip(0);
                        }
                    }
                    return uid;
                }
                scan.skip(0);
            }
            return "";
        } finally {
            scan.close();
        }
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

    /**
     * 只供 mergeArchiveJson 用的迷你 JSON 解析/输出，无外部依赖。
     * parse → LinkedHashMap / ArrayList / String / Double·Long / Boolean / null。
     */
    static final class MiniJson {
        private MiniJson() {}

        private static final class ParseException extends Exception {
            ParseException(String msg) { super(msg); }
        }

        static Object parse(String text) throws IOException {
            if (text == null) throw new IOException("null json");
            Parser p = new Parser(text);
            try {
                Object v = p.value();
                p.ws();
                if (!p.end()) throw new ParseException("trailing data");
                return v;
            } catch (ParseException e) {
                throw new IOException("invalid json: " + e.getMessage());
            }
        }

        static String stringify(Object value) {
            StringBuilder out = new StringBuilder();
            write(value, out);
            return out.toString();
        }

        private static void write(Object v, StringBuilder out) {
            if (v == null) { out.append("null"); return; }
            if (v instanceof String) { writeString((String) v, out); return; }
            if (v instanceof Boolean || v instanceof Number) { out.append(v.toString()); return; }
            if (v instanceof Map) {
                out.append('{');
                boolean first = true;
                for (Map.Entry<?, ?> e : ((Map<?, ?>) v).entrySet()) {
                    if (!first) out.append(',');
                    first = false;
                    writeString(String.valueOf(e.getKey()), out);
                    out.append(':');
                    write(e.getValue(), out);
                }
                out.append('}');
                return;
            }
            if (v instanceof List) {
                out.append('[');
                boolean first = true;
                for (Object item : (List<?>) v) {
                    if (!first) out.append(',');
                    first = false;
                    write(item, out);
                }
                out.append(']');
                return;
            }
            writeString(String.valueOf(v), out);
        }

        private static void writeString(String s, StringBuilder out) {
            out.append('"');
            for (int i = 0; i < s.length(); i++) {
                char c = s.charAt(i);
                switch (c) {
                    case '"': out.append("\\\""); break;
                    case '\\': out.append("\\\\"); break;
                    case '\n': out.append("\\n"); break;
                    case '\r': out.append("\\r"); break;
                    case '\t': out.append("\\t"); break;
                    case '\b': out.append("\\b"); break;
                    case '\f': out.append("\\f"); break;
                    default:
                        if (c < 0x20) out.append(String.format(java.util.Locale.US, "\\u%04x", (int) c));
                        else out.append(c);
                }
            }
            out.append('"');
        }

        private static final class Parser {
            private final String s;
            private int i;
            Parser(String s) { this.s = s; }

            boolean end() { return i >= s.length(); }
            void ws() { while (i < s.length() && (s.charAt(i) == ' ' || s.charAt(i) == '\t'
                    || s.charAt(i) == '\n' || s.charAt(i) == '\r' || s.charAt(i) == 0xfeff)) i++; }

            Object value() throws ParseException {
                ws();
                if (i >= s.length()) throw new ParseException("eof");
                char c = s.charAt(i);
                if (c == '{') return object();
                if (c == '[') return array();
                if (c == '"') return string();
                if (c == 't') { literal("true"); return Boolean.TRUE; }
                if (c == 'f') { literal("false"); return Boolean.FALSE; }
                if (c == 'n') { literal("null"); return null; }
                return number();
            }

            private Map<String, Object> object() throws ParseException {
                i++; // '{'
                Map<String, Object> map = new LinkedHashMap<String, Object>();
                ws();
                if (i < s.length() && s.charAt(i) == '}') { i++; return map; }
                while (true) {
                    ws();
                    String key = string();
                    ws();
                    if (i >= s.length() || s.charAt(i) != ':') throw new ParseException("expect ':'");
                    i++;
                    map.put(key, value());
                    ws();
                    if (i >= s.length()) throw new ParseException("eof in object");
                    char c = s.charAt(i);
                    if (c == ',') { i++; continue; }
                    if (c == '}') { i++; return map; }
                    throw new ParseException("expect ',' or '}'");
                }
            }

            private List<Object> array() throws ParseException {
                i++; // '['
                List<Object> list = new ArrayList<Object>();
                ws();
                if (i < s.length() && s.charAt(i) == ']') { i++; return list; }
                while (true) {
                    list.add(value());
                    ws();
                    if (i >= s.length()) throw new ParseException("eof in array");
                    char c = s.charAt(i);
                    if (c == ',') { i++; continue; }
                    if (c == ']') { i++; return list; }
                    throw new ParseException("expect ',' or ']'");
                }
            }

            private String string() throws ParseException {
                ws();
                if (i >= s.length() || s.charAt(i) != '"') throw new ParseException("expect '\"'");
                i++;
                StringBuilder out = new StringBuilder();
                while (i < s.length()) {
                    char c = s.charAt(i++);
                    if (c == '"') return out.toString();
                    if (c == '\\') {
                        if (i >= s.length()) break;
                        char e = s.charAt(i++);
                        switch (e) {
                            case 'n': out.append('\n'); break;
                            case 'r': out.append('\r'); break;
                            case 't': out.append('\t'); break;
                            case 'b': out.append('\b'); break;
                            case 'f': out.append('\f'); break;
                            case 'u':
                                if (i + 4 > s.length()) throw new ParseException("bad \\u");
                                out.append((char) Integer.parseInt(s.substring(i, i + 4), 16));
                                i += 4;
                                break;
                            default: out.append(e);
                        }
                    } else {
                        out.append(c);
                    }
                }
                throw new ParseException("unterminated string");
            }

            private void literal(String lit) throws ParseException {
                if (i + lit.length() > s.length() || !s.startsWith(lit, i)) {
                    throw new ParseException("expect " + lit);
                }
                i += lit.length();
            }

            private Object number() throws ParseException {
                int start = i;
                if (i < s.length() && (s.charAt(i) == '-' || s.charAt(i) == '+')) i++;
                boolean frac = false;
                while (i < s.length()) {
                    char c = s.charAt(i);
                    if (c >= '0' && c <= '9') { i++; continue; }
                    if (c == '.' || c == 'e' || c == 'E' || c == '-' || c == '+') {
                        frac = frac || c == '.' || c == 'e' || c == 'E';
                        i++;
                        continue;
                    }
                    break;
                }
                if (i == start) throw new ParseException("bad number");
                String num = s.substring(start, i);
                try {
                    if (frac) return Double.valueOf(num);
                    return Long.valueOf(num);
                } catch (NumberFormatException e) {
                    return Double.valueOf(num);
                }
            }
        }
    }
}
