package com.suisui.memorial;

import java.io.EOFException;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

/**
 * HTTP Range 响应。不依赖 Android，WebView 与 JVM 测试共用。
 * 有 Range 时返回 206，无 Range 时返回 200，两者都带 Accept-Ranges: bytes。
 */
public final class ByteRange {
    private ByteRange() {}

    public static final class Response {
        public final int status;
        public final String reason;
        public final String mime;
        public final String encoding;
        public final long start;
        public final long end;
        public final long total;
        public final InputStream body;
        public final Map<String, String> headers;

        Response(int status, String reason, String mime, String encoding,
                 long start, long end, long total, InputStream body, Map<String, String> headers) {
            this.status = status;
            this.reason = reason;
            this.mime = mime;
            this.encoding = encoding;
            this.start = start;
            this.end = end;
            this.total = total;
            this.body = body;
            this.headers = headers;
        }
    }

    public static Response open(File file, String rangeHeader, String mime) throws IOException {
        if (file == null || !file.isFile()) {
            throw new IOException("not a file");
        }
        long total = file.length();
        String type = mime == null || mime.length() == 0 ? "application/octet-stream" : mime;
        long[] span = parseByteRange(rangeHeader, total);
        if (span == null) {
            if (isBytesRange(rangeHeader)) {
                return unsatisfiable(type, total);
            }
            FileInputStream in = new FileInputStream(file);
            Map<String, String> headers = baseHeaders(type, total);
            return new Response(200, "OK", type, null, 0, total > 0 ? total - 1 : 0, total, in, headers);
        }
        long start = span[0];
        long end = span[1];
        long length = end - start + 1;
        FileInputStream in = new FileInputStream(file);
        try {
            skipFully(in, start);
        } catch (IOException e) {
            in.close();
            throw e;
        }
        InputStream limited = new LimitedInputStream(in, length);
        Map<String, String> headers = baseHeaders(type, length);
        headers.put("Content-Range", "bytes " + start + "-" + end + "/" + total);
        return new Response(206, "Partial Content", type, null, start, end, total, limited, headers);
    }

    private static Response unsatisfiable(String mime, long total) {
        Map<String, String> headers = baseHeaders(mime, 0);
        headers.put("Content-Range", "bytes */" + total);
        return new Response(416, "Range Not Satisfiable", mime, "utf-8", -1, -1, total, new InputStream() {
            @Override public int read() { return -1; }
            @Override public int read(byte[] b, int off, int len) { return -1; }
        }, headers);
    }

    static Map<String, String> baseHeaders(String mime, long contentLength) {
        Map<String, String> headers = new LinkedHashMap<String, String>();
        headers.put("Content-Type", mime);
        headers.put("Accept-Ranges", "bytes");
        headers.put("Content-Length", Long.toString(contentLength));
        headers.put("Access-Control-Allow-Origin", "*");
        headers.put("Access-Control-Expose-Headers", "Accept-Ranges, Content-Range, Content-Length, Content-Type");
        headers.put("Cache-Control", "no-store");
        return headers;
    }

    /** @return inclusive [start, end], or null if the header is absent / not a bytes range */
    static long[] parseByteRange(String header, long total) {
        if (!isBytesRange(header) || total < 0) return null;
        String spec = header.trim().substring(6).trim();
        int comma = spec.indexOf(',');
        if (comma >= 0) spec = spec.substring(0, comma).trim();
        int dash = spec.indexOf('-');
        if (dash < 0) return null;
        String left = spec.substring(0, dash).trim();
        String right = spec.substring(dash + 1).trim();
        try {
            long start;
            long end;
            if (left.length() == 0) {
                if (right.length() == 0 || total == 0) return null;
                long suffix = Long.parseLong(right);
                if (suffix <= 0) return null;
                if (suffix > total) suffix = total;
                start = total - suffix;
                end = total - 1;
            } else {
                start = Long.parseLong(left);
                if (start < 0 || start >= total) return null;
                if (right.length() == 0) {
                    end = total - 1;
                } else {
                    end = Long.parseLong(right);
                    if (end < start) return null;
                    if (end >= total) end = total - 1;
                }
            }
            return new long[] { start, end };
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static boolean isBytesRange(String header) {
        if (header == null) return false;
        String h = header.trim().toLowerCase(Locale.US);
        return h.startsWith("bytes=");
    }

    static void skipFully(InputStream in, long n) throws IOException {
        long left = n;
        while (left > 0) {
            long skipped = in.skip(left);
            if (skipped > 0) {
                left -= skipped;
                continue;
            }
            if (in.read() < 0) throw new EOFException("range start past end");
            left -= 1;
        }
    }

    /** 读满 remaining 字节后返回 EOF，并在关闭时关闭底层流。 */
    static final class LimitedInputStream extends InputStream {
        private final InputStream in;
        private long remaining;
        private boolean closed;

        LimitedInputStream(InputStream in, long remaining) {
            this.in = in;
            this.remaining = remaining;
        }

        @Override
        public int read() throws IOException {
            if (remaining <= 0) return -1;
            int b = in.read();
            if (b >= 0) remaining -= 1;
            return b;
        }

        @Override
        public int read(byte[] b, int off, int len) throws IOException {
            if (remaining <= 0) return -1;
            int want = len;
            if (want > remaining) want = (int) remaining;
            int n = in.read(b, off, want);
            if (n > 0) remaining -= n;
            return n;
        }

        @Override
        public void close() throws IOException {
            if (closed) return;
            closed = true;
            in.close();
        }
    }

    public static Map<String, String> unmodifiable(Map<String, String> headers) {
        return Collections.unmodifiableMap(headers);
    }
}
