package com.arkwebsites.clientcenter;

import android.Manifest;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.Locale;

@CapacitorPlugin(
    name = "PhonePermissions",
    permissions = {
        @Permission(
            alias = "notifications",
            strings = { Manifest.permission.POST_NOTIFICATIONS }
        ),
        @Permission(
            alias = "calendar",
            strings = {
                Manifest.permission.READ_CALENDAR,
                Manifest.permission.WRITE_CALENDAR
            }
        ),
        @Permission(
            alias = "contacts",
            strings = {
                Manifest.permission.READ_CONTACTS,
                Manifest.permission.WRITE_CONTACTS
            }
        )
    }
)
public class PhonePermissionsPlugin extends Plugin {
    private String label(PermissionState state) {
        if (state == null) return "denied";
        return state.name().toLowerCase(Locale.US).replace('_', '-');
    }

    private String notificationState() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            PermissionState runtimeState = getPermissionState("notifications");
            if (runtimeState != PermissionState.GRANTED) return label(runtimeState);
        }

        return NotificationManagerCompat.from(getContext()).areNotificationsEnabled()
            ? "granted"
            : "denied";
    }

    private JSObject currentState() {
        JSObject result = new JSObject();
        result.put("notifications", notificationState());
        result.put("calendar", label(getPermissionState("calendar")));
        result.put("contacts", label(getPermissionState("contacts")));
        return result;
    }

    private boolean granted(String permission) {
        return "granted".equals(currentState().getString(permission));
    }

    private boolean canShowRuntimePrompt(String permission) {
        PermissionState state = getPermissionState(permission);
        return state == PermissionState.PROMPT || state == PermissionState.PROMPT_WITH_RATIONALE;
    }

    private void openAndroidSettings(String permission) {
        Intent intent;
        if ("notifications".equals(permission) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
            intent.putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
        } else {
            intent = new Intent(
                Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.fromParts("package", getContext().getPackageName(), null)
            );
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
    }

    @PluginMethod
    public void check(PluginCall call) {
        call.resolve(currentState());
    }

    @PluginMethod
    public void request(PluginCall call) {
        String permission = call.getString("permission", "");
        if (!permission.equals("notifications") && !permission.equals("calendar") && !permission.equals("contacts")) {
            call.reject("Unknown phone permission.");
            return;
        }

        if (granted(permission)) {
            call.resolve(currentState());
            return;
        }

        if ("notifications".equals(permission) && Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            openAndroidSettings(permission);
            JSObject result = currentState();
            result.put("openedSettings", true);
            call.resolve(result);
            return;
        }

        if (canShowRuntimePrompt(permission)) {
            requestPermissionForAlias(permission, call, "permissionCallback");
            return;
        }

        openAndroidSettings(permission);
        JSObject result = currentState();
        result.put("openedSettings", true);
        call.resolve(result);
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        String permission = call.getString("permission", "");
        openAndroidSettings(permission);
        JSObject result = currentState();
        result.put("openedSettings", true);
        call.resolve(result);
    }

    @PermissionCallback
    private void permissionCallback(PluginCall call) {
        call.resolve(currentState());
    }
}
