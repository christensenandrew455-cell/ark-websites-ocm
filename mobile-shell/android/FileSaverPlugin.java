package com.arkwebsites.clientcenter;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

@CapacitorPlugin(name = "FileSaver")
public class FileSaverPlugin extends Plugin {
    private void openPicker(PluginCall call) {
        String fileName = call.getString("fileName");
        if (fileName == null || fileName.trim().isEmpty()) fileName = "client-data.json";

        String mimeType = call.getString("mimeType");
        if (mimeType == null || mimeType.trim().isEmpty()) mimeType = "application/json";

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mimeType);
        intent.putExtra(Intent.EXTRA_TITLE, fileName);
        startActivityForResult(call, intent, "saveFileResult");
    }

    @PluginMethod
    public void save(PluginCall call) {
        String base64 = call.getString("base64");
        if (base64 == null || base64.isEmpty()) {
            call.reject("The file data is missing.");
            return;
        }
        openPicker(call);
    }

    @PluginMethod
    public void saveFromUrl(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.trim().isEmpty()) {
            call.reject("The export URL is missing.");
            return;
        }
        openPicker(call);
    }

    private void resolveCanceled(PluginCall call) {
        JSObject result = new JSObject();
        result.put("saved", false);
        result.put("canceled", true);
        call.resolve(result);
    }

    private void resolveSaved(PluginCall call, Uri destination) {
        JSObject result = new JSObject();
        result.put("saved", true);
        result.put("canceled", false);
        result.put("uri", destination.toString());
        call.resolve(result);
    }

    private void writeBase64(PluginCall call, Uri destination) throws Exception {
        try (OutputStream output = getContext().getContentResolver().openOutputStream(destination, "w")) {
            if (output == null) throw new IllegalStateException("Android could not open the selected file.");
            byte[] bytes = Base64.decode(call.getString("base64"), Base64.DEFAULT);
            output.write(bytes);
            output.flush();
        }
    }

    private void streamUrl(PluginCall call, Uri destination) throws Exception {
        String sourceUrl = call.getString("url");
        String bearerToken = call.getString("bearerToken", "");
        HttpURLConnection connection = (HttpURLConnection) new URL(sourceUrl).openConnection();
        connection.setInstanceFollowRedirects(true);
        connection.setConnectTimeout(20000);
        connection.setReadTimeout(60000);
        connection.setRequestMethod("GET");
        connection.setRequestProperty("Accept", "application/json");
        if (!bearerToken.isEmpty()) connection.setRequestProperty("Authorization", "Bearer " + bearerToken);

        int status = connection.getResponseCode();
        if (status < 200 || status >= 300) {
            connection.disconnect();
            throw new IllegalStateException("The server could not prepare the client data. HTTP " + status + ".");
        }

        try (
            InputStream input = connection.getInputStream();
            OutputStream output = getContext().getContentResolver().openOutputStream(destination, "w")
        ) {
            if (output == null) throw new IllegalStateException("Android could not open the selected file.");
            byte[] buffer = new byte[16384];
            int read;
            while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
            output.flush();
        } finally {
            connection.disconnect();
        }
    }

    @ActivityCallback
    private void saveFileResult(PluginCall call, ActivityResult activityResult) {
        if (call == null) return;

        Intent data = activityResult.getData();
        Uri destination = data == null ? null : data.getData();
        if (activityResult.getResultCode() != Activity.RESULT_OK || destination == null) {
            resolveCanceled(call);
            return;
        }

        new Thread(() -> {
            try {
                String sourceUrl = call.getString("url", "");
                if (!sourceUrl.isEmpty()) streamUrl(call, destination);
                else writeBase64(call, destination);
                resolveSaved(call, destination);
            } catch (Exception error) {
                call.reject("The client data could not be saved: " + error.getMessage(), error);
            }
        }).start();
    }
}
