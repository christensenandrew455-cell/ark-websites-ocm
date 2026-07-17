import { mkdir, readFile, writeFile } from "node:fs/promises";

const manifestPath = "android/app/src/main/AndroidManifest.xml";
const javaDirectory = "android/app/src/main/java/com/arkwebsites/clientcenter";
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

await mkdir(javaDirectory, { recursive: true });

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

console.log("[Android configuration] Native contact editor registered.");
