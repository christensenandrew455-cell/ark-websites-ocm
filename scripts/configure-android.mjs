import { mkdir, readFile, writeFile } from "node:fs/promises";

const manifestPath = "android/app/src/main/AndroidManifest.xml";
const javaDirectory = "android/app/src/main/java/com/arkwebsites/clientcenter";
const drawableDirectory = "android/app/src/main/res/drawable";
const valuesDirectory = "android/app/src/main/res/values";
const adaptiveIconDirectory = "android/app/src/main/res/mipmap-anydpi-v26";
const permissions = [
  "android.permission.READ_CALENDAR",
  "android.permission.WRITE_CALENDAR",
  "android.permission.READ_CONTACTS",
  "android.permission.WRITE_CONTACTS",
];

let manifest = await readFile(manifestPath, "utf8");
const missing = permissions.filter((permission) => !manifest.includes(`android:name=\"${permission}\"`));

if (missing.length) {
  const permissionLines = missing
    .map((permission) => `    <uses-permission android:name=\"${permission}\" />`)
    .join("\n");
  manifest = manifest.replace(/<application\b/, `${permissionLines}\n\n    <application`);
  await writeFile(manifestPath, manifest, "utf8");
  console.log(`[Android configuration] Added ${missing.length} native permission(s).`);
} else {
  console.log("[Android configuration] Native permissions already present.");
}

await Promise.all([
  mkdir(javaDirectory, { recursive: true }),
  mkdir(drawableDirectory, { recursive: true }),
  mkdir(valuesDirectory, { recursive: true }),
  mkdir(adaptiveIconDirectory, { recursive: true }),
]);

await writeFile(`${javaDirectory}/ContactEditorPlugin.java`, `package com.arkwebsites.clientcenter;

import android.content.Intent;
import android.provider.ContactsContract;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "ContactEditor")
public class ContactEditorPlugin extends Plugin {
    private void putIfPresent(Intent intent, String key, String value) {
        if (value != null && !value.trim().isEmpty()) intent.putExtra(key, value.trim());
    }

    @PluginMethod
    public void open(PluginCall call) {
        try {
            Intent contactIntent = new Intent(Intent.ACTION_INSERT);
            contactIntent.setType(ContactsContract.Contacts.CONTENT_TYPE);
            putIfPresent(contactIntent, ContactsContract.Intents.Insert.NAME, call.getString("name"));
            putIfPresent(contactIntent, ContactsContract.Intents.Insert.PHONE, call.getString("phone"));
            putIfPresent(contactIntent, ContactsContract.Intents.Insert.EMAIL, call.getString("email"));
            putIfPresent(contactIntent, ContactsContract.Intents.Insert.POSTAL, call.getString("address"));
            putIfPresent(contactIntent, ContactsContract.Intents.Insert.NOTES, call.getString("note"));

            getActivity().startActivity(Intent.createChooser(contactIntent, "Add contact"));
            JSObject result = new JSObject();
            result.put("opened", true);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("No contacts app is available to add this person.", error);
        }
    }
}
`, "utf8");

await writeFile(`${javaDirectory}/MainActivity.java`, `package com.arkwebsites.clientcenter;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ContactEditorPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
`, "utf8");

await writeFile(`${valuesDirectory}/ark_brand_colors.xml`, `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ark_launcher_background">#FFFFFF</color>
</resources>
`, "utf8");

await writeFile(`${drawableDirectory}/ark_logo_foreground.xml`, `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <group
        android:translateX="1"
        android:translateY="8"
        android:scaleX="3.6"
        android:scaleY="3.6">
        <path
            android:fillColor="#08245B"
            android:pathData="M6.62,10.79C8.06,13.62 10.38,15.93 13.21,17.38L15.41,15.18C15.68,14.91 16.08,14.82 16.43,14.94C17.55,15.31 18.76,15.51 20,15.51C20.55,15.51 21,15.96 21,16.51L21,20C21,20.55 20.55,21 20,21C10.61,21 3,13.39 3,4C3,3.45 3.45,3 4,3L7.5,3C8.05,3 8.5,3.45 8.5,4C8.5,5.25 8.7,6.45 9.07,7.57C9.18,7.92 9.1,8.31 8.82,8.59L6.62,10.79Z" />
    </group>
    <path
        android:pathData="M54,31 L68,31 L75,24 L89,24"
        android:fillColor="@android:color/transparent"
        android:strokeColor="#1677FF"
        android:strokeWidth="4"
        android:strokeLineCap="round"
        android:strokeLineJoin="round" />
    <path
        android:pathData="M60,49 L76,49 L82,43 L94,43"
        android:fillColor="@android:color/transparent"
        android:strokeColor="#1677FF"
        android:strokeWidth="4"
        android:strokeLineCap="round"
        android:strokeLineJoin="round" />
    <path
        android:pathData="M54,67 L68,67 L75,74 L89,74"
        android:fillColor="@android:color/transparent"
        android:strokeColor="#1677FF"
        android:strokeWidth="4"
        android:strokeLineCap="round"
        android:strokeLineJoin="round" />
    <path
        android:pathData="M94,19 C96.761,19 99,21.239 99,24 C99,26.761 96.761,29 94,29 C91.239,29 89,26.761 89,24 C89,21.239 91.239,19 94,19 Z"
        android:fillColor="#FFFFFF"
        android:strokeColor="#1677FF"
        android:strokeWidth="3" />
    <path
        android:pathData="M99,38 C101.761,38 104,40.239 104,43 C104,45.761 101.761,48 99,48 C96.239,48 94,45.761 94,43 C94,40.239 96.239,38 99,38 Z"
        android:fillColor="#FFFFFF"
        android:strokeColor="#1677FF"
        android:strokeWidth="3" />
    <path
        android:pathData="M94,69 C96.761,69 99,71.239 99,74 C99,76.761 96.761,79 94,79 C91.239,79 89,76.761 89,74 C89,71.239 91.239,69 94,69 Z"
        android:fillColor="#FFFFFF"
        android:strokeColor="#1677FF"
        android:strokeWidth="3" />
</vector>
`, "utf8");

const adaptiveIcon = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ark_launcher_background" />
    <foreground android:drawable="@drawable/ark_logo_foreground" />
</adaptive-icon>
`;

await Promise.all([
  writeFile(`${adaptiveIconDirectory}/ic_launcher.xml`, adaptiveIcon, "utf8"),
  writeFile(`${adaptiveIconDirectory}/ic_launcher_round.xml`, adaptiveIcon, "utf8"),
]);

console.log("[Android configuration] Native contact editor registered.");
console.log("[Android configuration] ARK Client Center launcher icon applied.");
