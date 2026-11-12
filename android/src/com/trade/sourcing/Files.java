package com.trade.sourcing;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import android.webkit.MimeTypeMap;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;

/** Hands files in the app's cache (reports to share/open, camera photos) to other apps. */
public class Files extends ContentProvider {
    static final String AUTHORITY = "com.trade.sourcing.files";

    static File dir(Context c, String sub) {
        File d = new File(c.getCacheDir(), sub);
        d.mkdirs();
        return d;
    }

    static Uri uri(File f) {
        return new Uri.Builder().scheme("content").authority(AUTHORITY)
                .appendPath(f.getParentFile().getName()).appendPath(f.getName()).build();
    }

    private File file(Uri uri) throws FileNotFoundException {
        if (uri.getPathSegments().size() != 2) throw new FileNotFoundException();
        String sub = uri.getPathSegments().get(0), name = uri.getPathSegments().get(1);
        if (!(sub.equals("share") || sub.equals("photos")) || name.contains("/") || name.startsWith(".")) throw new FileNotFoundException();
        return new File(new File(getContext().getCacheDir(), sub), name);
    }

    static String mime(String name) {
        int i = name.lastIndexOf('.');
        String t = i < 0 ? null : MimeTypeMap.getSingleton().getMimeTypeFromExtension(name.substring(i + 1).toLowerCase());
        return t == null ? "application/octet-stream" : t;
    }

    @Override public boolean onCreate() { return true; }

    @Override public String getType(Uri uri) { return mime(uri.getLastPathSegment()); }

    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        File f = file(uri);
        if (mode.contains("w")) {
            try { f.getParentFile().mkdirs(); f.createNewFile(); } catch (IOException e) { throw new FileNotFoundException(e.getMessage()); }
        }
        return ParcelFileDescriptor.open(f, ParcelFileDescriptor.parseMode(mode));
    }

    @Override public Cursor query(Uri uri, String[] projection, String sel, String[] args, String sort) {
        File f;
        try { f = file(uri); } catch (FileNotFoundException e) { return null; }
        if (projection == null) projection = new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE};
        MatrixCursor c = new MatrixCursor(projection, 1);
        Object[] row = new Object[projection.length];
        for (int i = 0; i < projection.length; i++) {
            if (OpenableColumns.DISPLAY_NAME.equals(projection[i])) row[i] = f.getName();
            else if (OpenableColumns.SIZE.equals(projection[i])) row[i] = f.length();
        }
        c.addRow(row);
        return c;
    }

    @Override public Uri insert(Uri uri, ContentValues v) { return null; }
    @Override public int delete(Uri uri, String s, String[] a) { return 0; }
    @Override public int update(Uri uri, ContentValues v, String s, String[] a) { return 0; }
}
