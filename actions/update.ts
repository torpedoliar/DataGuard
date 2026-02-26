"use server";

import fs from "fs/promises";
import path from "path";

export interface VersionInfo {
    version: string;
    releaseDate: string;
    minDatabaseVersion: string;
    changelog: string[];
    repository: string;
    branch: string;
}

/**
 * Membaca versi aplikasi saat ini dari file local `version.json`
 */
export async function getCurrentVersion(): Promise<VersionInfo | null> {
    try {
        const filePath = path.join(process.cwd(), "version.json");
        const fileContent = await fs.readFile(filePath, "utf-8");
        return JSON.parse(fileContent);
    } catch (error) {
        console.error("Gagal membaca version.json lokal:", error);
        return null;
    }
}

/**
 * Mengecek apakah ada update terbaru dari repository Git
 */
export async function checkSystemUpdate(): Promise<{
    current: VersionInfo | null;
    latest: VersionInfo | null;
    updateAvailable: boolean;
}> {
    const current = await getCurrentVersion();

    if (!current) {
        throw new Error("Local version.json not found!");
    }

    try {
        // Ambil string raw repository lalu reformat untuk mendapatkan raw url Github
        // Contoh repo: https://github.com/torpedoliar/DataGuard
        // RAW url: https://raw.githubusercontent.com/torpedoliar/DataGuard/refs/heads/main/version.json
        const repoUrl = new URL(current.repository);
        const repoPath = repoUrl.pathname; // /torpedoliar/DataGuard
        const rawUrl = `https://raw.githubusercontent.com${repoPath}/refs/heads/${current.branch}/version.json`;

        // Fetch tanpa cache agar mendapatkan versi yang paling akurat dari internet
        const res = await fetch(rawUrl, { cache: "no-store" });

        if (!res.ok) {
            throw new Error(`Failed to fetch remote version: ${res.statusText}`);
        }

        const latest: VersionInfo = await res.json();

        // Bandingkan versi secara sederhana
        // Jika string version beda, kita asumsikan updateAvailable
        // Pada praktek yang lebih kompleks bisa menggunakan library 'semver'
        const updateAvailable = latest.version !== current.version;

        return { current, latest, updateAvailable };
    } catch (error) {
        console.error("Gagal melakukan pengecekan update via GitHub:", error);
        return {
            current,
            latest: null,
            updateAvailable: false,
        };
    }
}
