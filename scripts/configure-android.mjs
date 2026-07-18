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
        android:translateX="18.36"
        android:translateY="17.6"
        android:scaleX="0.66"
        android:scaleY="0.64">
        <path
            android:fillColor="#08245B"
            android:fillType="evenOdd"
            android:pathData="M34.259,50.892 L25.232,50.892 L23.807,60.000 L18.000,60.000 L26.293,10.000 L33.179,10.000 L41.472,60.000 L35.670,60.000 L34.259,50.892 Z M26.672,41.612 L32.805,41.612 L29.743,21.723 L26.672,41.612 Z M52.644,32.171 Q54.458,32.171 55.245,30.671 Q56.032,29.160 56.032,25.709 Q56.032,22.291 55.245,20.823 Q54.458,19.344 52.644,19.344 L50.216,19.344 L50.216,32.171 L52.644,32.171 Z M50.216,41.076 L50.216,60.000 L44.443,60.000 L44.443,10.000 L53.259,10.000 Q57.683,10.000 59.742,13.322 Q61.806,16.633 61.806,23.802 Q61.806,28.753 60.731,31.935 Q59.660,35.118 57.501,36.629 Q58.686,37.229 59.622,39.361 Q60.563,41.483 61.522,45.802 L64.656,60.000 L58.509,60.000 L55.778,47.580 Q54.953,43.830 54.103,42.458 Q53.259,41.076 51.848,41.076 L50.216,41.076 Z M68.093,10.000 L73.866,10.000 L73.866,28.249 L82.187,10.000 L88.891,10.000 L78.108,33.682 L90.000,60.000 L82.773,60.000 L73.866,40.304 L73.866,60.000 L68.093,60.000 L68.093,10.000 Z" />
    </group>

    <group
        android:translateX="15.12"
        android:translateY="-0.6"
        android:scaleX="0.72"
        android:scaleY="0.72">
        <path
            android:fillColor="#64748B"
            android:fillType="evenOdd"
            android:pathData="M30.651,82.490 L30.651,83.223 Q30.299,82.896 29.901,82.735 Q29.503,82.573 29.055,82.573 Q28.172,82.573 27.704,83.112 Q27.235,83.652 27.235,84.672 Q27.235,85.689 27.704,86.229 Q28.172,86.768 29.055,86.768 Q29.503,86.768 29.901,86.606 Q30.299,86.444 30.651,86.116 L30.651,86.844 Q30.286,87.092 29.877,87.217 Q29.469,87.341 29.014,87.341 Q27.845,87.341 27.172,86.626 Q26.500,85.910 26.500,84.672 Q26.500,83.431 27.172,82.716 Q27.845,82.000 29.014,82.000 Q29.475,82.000 29.884,82.122 Q30.293,82.245 30.651,82.490 Z M31.727,82.093 L32.423,82.093 L32.423,86.654 L34.929,86.654 L34.929,87.240 L31.727,87.240 L31.727,82.093 Z M35.660,82.093 L36.357,82.093 L36.357,87.240 L35.660,87.240 L35.660,82.093 Z M37.743,82.093 L40.997,82.093 L40.997,82.680 L38.439,82.680 L38.439,84.203 L40.890,84.203 L40.890,84.789 L38.439,84.789 L38.439,86.654 L41.059,86.654 L41.059,87.240 L37.743,87.240 L37.743,82.093 Z M42.204,82.093 L43.142,82.093 L45.424,86.399 L45.424,82.093 L46.099,82.093 L46.099,87.240 L45.162,87.240 L42.880,82.934 L42.880,87.240 L42.204,87.240 L42.204,82.093 Z M46.772,82.093 L51.126,82.093 L51.126,82.680 L49.299,82.680 L49.299,87.240 L48.600,87.240 L48.600,82.680 L46.772,82.680 L46.772,82.093 Z M57.898,82.490 L57.898,83.223 Q57.546,82.896 57.147,82.735 Q56.749,82.573 56.301,82.573 Q55.419,82.573 54.950,83.112 Q54.481,83.652 54.481,84.672 Q54.481,85.689 54.950,86.229 Q55.419,86.768 56.301,86.768 Q56.749,86.768 57.147,86.606 Q57.546,86.444 57.898,86.116 L57.898,86.844 Q57.532,87.092 57.123,87.217 Q56.715,87.341 56.260,87.341 Q55.091,87.341 54.418,86.626 Q53.746,85.910 53.746,84.672 Q53.746,83.431 54.418,82.716 Q55.091,82.000 56.260,82.000 Q56.722,82.000 57.130,82.122 Q57.539,82.245 57.898,82.490 Z M58.973,82.093 L62.227,82.093 L62.227,82.680 L59.669,82.680 L59.669,84.203 L62.120,84.203 L62.120,84.789 L59.669,84.789 L59.669,86.654 L62.289,86.654 L62.289,87.240 L58.973,87.240 L58.973,82.093 Z M63.434,82.093 L64.372,82.093 L66.654,86.399 L66.654,82.093 L67.330,82.093 L67.330,87.240 L66.392,87.240 L64.110,82.934 L64.110,87.240 L63.434,87.240 L63.434,82.093 Z M68.002,82.093 L72.356,82.093 L72.356,82.680 L70.529,82.680 L70.529,87.240 L69.830,87.240 L69.830,82.680 L68.002,82.680 L68.002,82.093 Z M73.029,82.093 L76.283,82.093 L76.283,82.680 L73.725,82.680 L73.725,84.203 L76.176,84.203 L76.176,84.789 L73.725,84.789 L73.725,86.654 L76.345,86.654 L76.345,87.240 L73.029,87.240 L73.029,82.093 Z M79.931,84.826 Q80.155,84.903 80.367,85.151 Q80.579,85.399 80.793,85.834 L81.500,87.240 L80.751,87.240 L80.093,85.920 Q79.837,85.402 79.598,85.234 Q79.359,85.065 78.945,85.065 L78.186,85.065 L78.186,87.240 L77.490,87.240 L77.490,82.093 L79.062,82.093 Q79.944,82.093 80.379,82.462 Q80.814,82.831 80.814,83.575 Q80.814,84.062 80.588,84.383 Q80.361,84.703 79.931,84.826 Z M78.186,82.665 L78.186,84.492 L79.062,84.492 Q79.565,84.492 79.822,84.259 Q80.079,84.027 80.079,83.575 Q80.079,83.124 79.822,82.895 Q79.565,82.665 79.062,82.665 L78.186,82.665 Z" />
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
console.log("[Android configuration] Compact centered ARK Client Center launcher icon applied.");