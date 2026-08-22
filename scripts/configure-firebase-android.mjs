import fs from "node:fs";

const configPath = process.argv[2] ?? "android/app/google-services.json";
const expectedProjectNumber = "525909893817";
const expectedProjectId = "ark-348a0";
const expectedPackage = "com.arkwebsites.app";
const expectedMobileSdkAppId = "1:525909893817:android:2a99f6b230ba2d846db168";
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

if (
  String(config.project_info?.project_number) !== expectedProjectNumber ||
  config.project_info?.project_id !== expectedProjectId
) {
  throw new Error("The Firebase Android configuration belongs to the wrong project.");
}

config.client ??= [];
let client = config.client.find(
  (entry) => entry.client_info?.android_client_info?.package_name === expectedPackage,
);

if (!client) {
  const projectTemplate = config.client.find((entry) => entry.api_key?.length);
  if (!projectTemplate) {
    throw new Error("The Firebase Android configuration does not contain a project API key.");
  }

  client = {
    client_info: {
      mobilesdk_app_id: expectedMobileSdkAppId,
      android_client_info: { package_name: expectedPackage },
    },
    oauth_client: [],
    api_key: projectTemplate.api_key,
    services: projectTemplate.services ?? {
      appinvite_service: { other_platform_oauth_client: [] },
    },
  };
  config.client.push(client);
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

if (client.client_info?.mobilesdk_app_id !== expectedMobileSdkAppId) {
  throw new Error("The Firebase client for com.arkwebsites.app has the wrong mobile SDK app ID.");
}

console.log("Firebase Cloud Messaging configuration for com.arkwebsites.app added and validated.");
