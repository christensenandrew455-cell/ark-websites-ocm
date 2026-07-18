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
        android:translateX="27"
        android:translateY="6"
        android:scaleX="0.55"
        android:scaleY="0.55">
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

    <path
        android:pathData="M32,57 L27,57 L25,59 L25,65 L27,67 L32,67 M35,57 L35,67 L42,67 M45,57 L52,57 M48.5,57 L48.5,67 M45,67 L52,67 M55,57 L62,57 M55,57 L55,67 M55,62 L61,62 M55,67 L62,67 M65,67 L65,57 L72,67 L72,57 M75,57 L82,57 M78.5,57 L78.5,67"
        android:fillColor="@android:color/transparent"
        android:strokeColor="#5F6B85"
        android:strokeWidth="1.5"
        android:strokeLineCap="round"
        android:strokeLineJoin="round" />

    <path
        android:pathData="M32,74 L27,74 L25,76 L25,82 L27,84 L32,84 M35,74 L42,74 M35,74 L35,84 M35,79 L41,79 M35,84 L42,84 M45,84 L45,74 L52,84 L52,74 M55,74 L62,74 M58.5,74 L58.5,84 M65,74 L72,74 M65,74 L65,84 M65,79 L71,79 M65,84 L72,84 M75,84 L75,74 L80,74 L82,76 L82,78 L80,79 L75,79 M79,79 L83,84"
        android:fillColor="@android:color/transparent"
        android:strokeColor="#5F6B85"
        android:strokeWidth="1.5"
        android:strokeLineCap="round"
        android:strokeLineJoin="round" />
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
console.log("[Android configuration] Compact ARK Client Center launcher icon applied.");