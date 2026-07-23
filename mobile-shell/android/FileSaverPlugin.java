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

import java.io.OutputStream;

@CapacitorPlugin(name = "FileSaver")
public class FileSaverPlugin extends Plugin {
    @PluginMethod
    public void save(PluginCall call) {
        String base64 = call.getString("base64");
        if (base64 == null || base64.isEmpty()) {
            call.reject("The file data is missing.");
            return;
        }

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

    @ActivityCallback
    private void saveFileResult(PluginCall call, ActivityResult activityResult) {
        if (call == null) return;

        Intent data = activityResult.getData();
        Uri destination = data == null ? null : data.getData();
        if (activityResult.getResultCode() != Activity.RESULT_OK || destination == null) {
            JSObject result = new JSObject();
            result.put("saved", false);
            result.put("canceled", true);
            call.resolve(result);
            return;
        }

        try (OutputStream output = getContext().getContentResolver().openOutputStream(destination, "w")) {
            if (output == null) {
                call.reject("Android could not open the selected file.");
                return;
            }

            byte[] bytes = Base64.decode(call.getString("base64"), Base64.DEFAULT);
            output.write(bytes);
            output.flush();

            JSObject result = new JSObject();
            result.put("saved", true);
            result.put("canceled", false);
            result.put("uri", destination.toString());
            call.resolve(result);
        } catch (Exception error) {
            call.reject("The client data could not be saved.", error);
        }
    }
}
