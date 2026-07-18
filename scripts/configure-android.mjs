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
        android:translateX="12.6"
        android:translateY="15.1"
        android:scaleX="0.72"
        android:scaleY="0.72">
        <path
            android:pathData="M12,76 L28,32 L44,76 M19,59 L37,59"
            android:fillColor="@android:color/transparent"
            android:strokeColor="#08245B"
            android:strokeWidth="5.5"
            android:strokeLineCap="round"
            android:strokeLineJoin="round" />
        <path
            android:pathData="M50,76 L50,32 L66,32 C84,32 84,51 66,51 L50,51 M66,51 L82,76"
            android:fillColor="@android:color/transparent"
            android:strokeColor="#08245B"
            android:strokeWidth="5.5"
            android:strokeLineCap="round"
            android:strokeLineJoin="round" />
        <path
            android:pathData="M88,32 L88,76 M88,55 L103,38 M88,55 L103,72"
            android:fillColor="@android:color/transparent"
            android:strokeColor="#08245B"
            android:strokeWidth="5.5"
            android:strokeLineCap="round"
            android:strokeLineJoin="round" />
    </group>
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
console.log("[Android configuration] Padded ARK launcher icon applied.");