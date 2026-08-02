package com.kaoyan.studyhelper.plugins;

import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.PermissionResultCallback;

import android.Manifest;
import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.util.Base64;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;

/**
 * 相机 / 相册 原生插件（Capacitor 桥）
 * 前端通过 Capacitor.Plugins.Camera.takePhoto() / pickFromGallery() 调用。
 * 返回压缩后的 base64（data:image/jpeg;base64,...），供视觉模型直接消费。
 * 与 WakeAlarm 插件一致：本地 Java 插件需在前端手动 Capacitor.registerPlugin('Camera') 桥接。
 */
@CapacitorPlugin(name = "Camera")
public class CameraPlugin extends Plugin {

    private static final int REQ_CAMERA = 2001;
    private static final int REQ_GALLERY = 2002;
    private static final int REQ_CAMERA_PERM = 2003;
    private static final int REQ_GALLERY_PERM = 2004;
    private static final int MAX_DIM = 1280;
    private static final int QUALITY = 80;

    private PluginCall pendingCall;
    private File cameraTempFile;

    @PluginMethod
    public void takePhoto(PluginCall call) {
        if (getPermissionState(Manifest.permission.CAMERA) != PermissionState.GRANTED) {
            requestPermissionForResult(Manifest.permission.CAMERA, REQ_CAMERA_PERM,
                new PermissionResultCallback() {
                    @Override
                    public void handlePermissionResult(int requestCode, String permission, PermissionState state) {
                        if (state == PermissionState.GRANTED) launchCamera(call);
                        else call.reject("相机权限被拒绝");
                    }
                });
            return;
        }
        launchCamera(call);
    }

    @PluginMethod
    public void pickFromGallery(PluginCall call) {
        String perm = galleryPermission();
        if (getPermissionState(perm) != PermissionState.GRANTED) {
            requestPermissionForResult(perm, REQ_GALLERY_PERM,
                new PermissionResultCallback() {
                    @Override
                    public void handlePermissionResult(int requestCode, String permission, PermissionState state) {
                        if (state == PermissionState.GRANTED) launchGallery(call);
                        else call.reject("相册权限被拒绝");
                    }
                });
            return;
        }
        launchGallery(call);
    }

    private String galleryPermission() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                ? Manifest.permission.READ_MEDIA_IMAGES
                : Manifest.permission.READ_EXTERNAL_STORAGE;
    }

    private void launchCamera(PluginCall call) {
        this.pendingCall = call;
        try {
            cameraTempFile = new File(getContext().getCacheDir(),
                    "cap_camera_" + System.currentTimeMillis() + ".jpg");
            Uri uri = androidx.core.content.FileProvider.getUriForFile(
                    getContext(), getContext().getPackageName() + ".fileprovider", cameraTempFile);
            Intent intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            intent.putExtra(MediaStore.EXTRA_OUTPUT, uri);
            intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            startActivityForResult(call, intent, REQ_CAMERA);
        } catch (Exception e) {
            pendingCall = null;
            call.reject("启动相机失败: " + e.getMessage());
        }
    }

    private void launchGallery(PluginCall call) {
        this.pendingCall = call;
        try {
            Intent intent = new Intent(Intent.ACTION_PICK, MediaStore.Images.Media.EXTERNAL_CONTENT_URI);
            intent.setType("image/*");
            startActivityForResult(call, intent, REQ_GALLERY);
        } catch (Exception e) {
            pendingCall = null;
            call.reject("启动相册失败: " + e.getMessage());
        }
    }

    @Override
    protected void handleOnActivityResult(int requestCode, int resultCode, Intent data) {
        super.handleOnActivityResult(requestCode, resultCode, data);
        PluginCall call = pendingCall;
        pendingCall = null;
        if (call == null) return;
        if (resultCode != Activity.RESULT_OK) {
            call.reject("用户取消");
            return;
        }
        try {
            Bitmap bitmap;
            if (requestCode == REQ_CAMERA) {
                bitmap = decodeSampledFile(cameraTempFile.getAbsolutePath());
            } else {
                Uri uri = data != null ? data.getData() : null;
                if (uri == null) { call.reject("未选择图片"); return; }
                bitmap = decodeSampledUri(uri);
            }
            if (bitmap == null) { call.reject("图片解码失败"); return; }
            String b64 = bitmapToBase64(bitmap);
            JSObject ret = new JSObject();
            ret.put("data", "data:image/jpeg;base64," + b64);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("处理图片失败: " + e.getMessage());
        }
    }

    private Bitmap decodeSampledFile(String path) {
        BitmapFactory.Options opts = new BitmapFactory.Options();
        opts.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(path, opts);
        opts.inSampleSize = sampleSize(opts.outWidth, opts.outHeight);
        opts.inJustDecodeBounds = false;
        return BitmapFactory.decodeFile(path, opts);
    }

    private Bitmap decodeSampledUri(Uri uri) throws Exception {
        ContentResolver cr = getContext().getContentResolver();
        BitmapFactory.Options opts = new BitmapFactory.Options();
        opts.inJustDecodeBounds = true;
        InputStream is1 = cr.openInputStream(uri);
        BitmapFactory.decodeStream(is1, null, opts);
        is1.close();
        opts.inSampleSize = sampleSize(opts.outWidth, opts.outHeight);
        opts.inJustDecodeBounds = false;
        InputStream is2 = cr.openInputStream(uri);
        Bitmap bmp = BitmapFactory.decodeStream(is2, null, opts);
        is2.close();
        return bmp;
    }

    private int sampleSize(int w, int h) {
        int inSample = 1;
        while (w / inSample > MAX_DIM || h / inSample > MAX_DIM) inSample *= 2;
        return inSample;
    }

    private String bitmapToBase64(Bitmap bitmap) {
        float scale = Math.min(1f, (float) MAX_DIM / Math.max(bitmap.getWidth(), bitmap.getHeight()));
        Bitmap scaled = bitmap;
        if (scale < 1f) {
            scaled = Bitmap.createScaledBitmap(bitmap,
                    Math.round(bitmap.getWidth() * scale), Math.round(bitmap.getHeight() * scale), true);
        }
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        scaled.compress(Bitmap.CompressFormat.JPEG, QUALITY, baos);
        if (scaled != bitmap) scaled.recycle();
        return Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP);
    }
}
