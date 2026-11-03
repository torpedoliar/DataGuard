"use client";

import { useState, useTransition, useRef } from "react";
import { updateProfilePhoto, changePassword } from "@/actions/users";
import { User, Camera, Trash2, KeyRound, Loader2 } from "lucide-react";

type UserData = {
    username: string;
    role: string;
    photoPath: string | null;
    email: string | null;
};

export default function ProfileForm({ user }: { user: UserData }) {
    const [isPendingPhoto, startTransitionPhoto] = useTransition();
    const [isPendingPassword, startTransitionPassword] = useTransition();

    const [photoPreview, setPhotoPreview] = useState<string | null>(user.photoPath);
    const [photoFile, setPhotoFile] = useState<File | null>(null);
    const [isRemovingPhoto, setIsRemovingPhoto] = useState(false);

    // Password form state
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");

    const [photoMessage, setPhotoMessage] = useState<{ type: "success" | "error", text: string } | null>(null);
    const [passwordMessage, setPasswordMessage] = useState<{ type: "success" | "error", text: string } | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);

    const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            // 10MB limit
            if (file.size > 10 * 1024 * 1024) {
                alert("Ukuran foto maksimal 10MB");
                if (fileInputRef.current) fileInputRef.current.value = "";
                return;
            }

            setPhotoFile(file);
            setIsRemovingPhoto(false);

            // Preview
            const reader = new FileReader();
            reader.onloadend = () => {
                setPhotoPreview(reader.result as string);
            };
            reader.readAsDataURL(file);
        }
    };

    const handleRemovePhoto = () => {
        setPhotoPreview(null);
        setPhotoFile(null);
        setIsRemovingPhoto(true);
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

    const handlePhotoSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setPhotoMessage(null);

        // Optimistic UX, prevent submitting if nothing changed
        if (!photoFile && !isRemovingPhoto) {
            return;
        }

        startTransitionPhoto(async () => {
            const formData = new FormData();
            if (photoFile) {
                formData.append("photo", photoFile);
            }
            if (isRemovingPhoto) {
                formData.append("removePhoto", "true");
            }

            const result = await updateProfilePhoto(null, formData);
            if (result.success) {
                setPhotoMessage({ type: "success", text: result.message! });
                setIsRemovingPhoto(false);
                setPhotoFile(null);
            } else {
                setPhotoMessage({ type: "error", text: result.message! });
            }

            // Clear message after 3 seconds
            setTimeout(() => setPhotoMessage(null), 3000);
        });
    };

    const handlePasswordSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setPasswordMessage(null);

        if (newPassword !== confirmPassword) {
            setPasswordMessage({ type: "error", text: "Konfirmasi password baru tidak cocok." });
            return;
        }

        startTransitionPassword(async () => {
            const formData = new FormData();
            formData.append("currentPassword", currentPassword);
            formData.append("newPassword", newPassword);
            formData.append("confirmPassword", confirmPassword);

            const result = await changePassword(null, formData);

            if (result.success) {
                setPasswordMessage({ type: "success", text: result.message! });
                setCurrentPassword("");
                setNewPassword("");
                setConfirmPassword("");
            } else {
                // Formatting zod errors if they exist, otherwise use explicit message
                let errorMsg = result.message || "Gagal mengubah password.";
                if (result.errors) {
                    const errorValues = Object.values(result.errors).flat();
                    if (errorValues.length > 0) {
                        errorMsg = errorValues[0] as string;
                    }
                }
                setPasswordMessage({ type: "error", text: errorMsg });
            }

            // Clear message after 3 seconds
            setTimeout(() => setPasswordMessage(null), 3000);
        });
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 max-w-5xl mx-auto">
            {/* Foto Profil & Info */}
            <div className="col-span-1 lg:col-span-5 space-y-6">
                <div className="bg-ops-surface/50 rounded-2xl border border-ops-border/50 p-6 backdrop-blur-sm">
                    <h2 className="text-lg font-semibold text-ops-text mb-6 flex items-center gap-2">
                        <User className="size-5 text-ops-info" />
                        Profil Anda
                    </h2>

                    <div className="flex flex-col items-center">
                        <div className="relative group mb-6">
                            <div className="size-32 rounded-full overflow-hidden border-4 border-ops-border bg-ops-bg flex items-center justify-center relative shadow-xl">
                                {photoPreview ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={photoPreview} alt="Profile preview" className="h-full w-full object-cover" />
                                ) : (
                                    <span className="text-4xl font-bold text-ops-muted">
                                        {user.username.substring(0, 2).toUpperCase()}
                                    </span>
                                )}

                                {/* Overlay for hover */}
                                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                                    <Camera className="size-8 text-white" />
                                </div>
                            </div>

                            {photoPreview && (
                                <button
                                    type="button"
                                    onClick={handleRemovePhoto}
                                    className="absolute bottom-0 right-0 bg-ops-danger-soft hover:bg-ops-danger/20 text-ops-danger p-2 rounded-full shadow-lg transition-transform hover:scale-110"
                                    title="Hapus foto"
                                >
                                    <Trash2 className="size-4" />
                                </button>
                            )}
                        </div>

                        <div className="text-center w-full">
                            <h3 className="text-xl font-bold text-ops-text mb-1">{user.username}</h3>
                            <p className="text-sm text-ops-info bg-ops-info-soft px-3 py-1 rounded-full inline-block font-medium capitalize mb-2">
                                {user.role}
                            </p>
                            {user.email && (
                                <p className="text-sm text-ops-muted">{user.email}</p>
                            )}
                        </div>
                    </div>

                    <div className="mt-8 pt-6 border-t border-ops-border/50">
                        <form onSubmit={handlePhotoSubmit} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-ops-text mb-2">
                                    Ubah Foto Profil
                                </label>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/*"
                                    onChange={handlePhotoChange}
                                    className="w-full text-sm text-ops-muted
                                        file:mr-4 file:py-2 file:px-4
                                        file:rounded-full file:border-0
                                        file:text-sm file:font-semibold
                                        file:bg-ops-accent-soft file:text-ops-accent
                                        hover:file:bg-ops-info-soft file:transition-colors cursor-pointer"
                                />
                                <p className="text-xs text-ops-muted mt-2">Format: JPG, PNG, GIF. Maks. 10MB.</p>
                            </div>

                            {photoMessage && (
                                <div className={`p-3 rounded-lg text-sm border flex items-start gap-2 ${photoMessage.type === 'success' ? 'bg-ops-success-soft border-ops-success/20 text-ops-success' : 'bg-ops-danger-soft border-ops-danger/20 text-ops-danger'}`}>
                                    {photoMessage.text}
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={isPendingPhoto || (!photoFile && !isRemovingPhoto)}
                                className="w-full h-10 bg-ops-accent hover:bg-ops-accent-hover disabled:bg-ops-surface-raised disabled:text-ops-muted text-ops-accent-fg font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                            >
                                {isPendingPhoto && <Loader2 className="size-4 animate-spin" />}
                                Simpan Foto
                            </button>
                        </form>
                    </div>
                </div>
            </div>

            {/* Ganti Password */}
            <div className="col-span-1 lg:col-span-7 space-y-6">
                <div className="bg-ops-surface/50 rounded-2xl border border-ops-border/50 p-6 backdrop-blur-sm">
                    <h2 className="text-lg font-semibold text-ops-text mb-6 flex items-center gap-2">
                        <KeyRound className="size-5 text-ops-warning" />
                        Ganti Password
                    </h2>

                    <form onSubmit={handlePasswordSubmit} className="space-y-5">
                        <div>
                            <label className="block text-sm font-medium text-ops-text mb-1.5">
                                Password Saat Ini
                            </label>
                            <input
                                type="password"
                                value={currentPassword}
                                onChange={(e) => setCurrentPassword(e.target.value)}
                                required
                                className="w-full h-10 px-3 rounded-lg bg-ops-bg border border-ops-border text-sm text-ops-text focus:border-ops-info focus:ring-1 focus:ring-ops-info transition-colors"
                                placeholder="Masukkan password saat ini"
                            />
                        </div>

                        <div className="border-t border-ops-border/50 pt-5">
                            <label className="block text-sm font-medium text-ops-text mb-1.5">
                                Password Baru
                            </label>
                            <input
                                type="password"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                required
                                minLength={6}
                                className="w-full h-10 px-3 rounded-lg bg-ops-bg border border-ops-border text-sm text-ops-text focus:border-ops-info focus:ring-1 focus:ring-ops-info transition-colors"
                                placeholder="Minimal 6 karakter"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-ops-text mb-1.5">
                                Konfirmasi Password Baru
                            </label>
                            <input
                                type="password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                required
                                minLength={6}
                                className="w-full h-10 px-3 rounded-lg bg-ops-bg border border-ops-border text-sm text-ops-text focus:border-ops-info focus:ring-1 focus:ring-ops-info transition-colors"
                                placeholder="Ketik ulang password baru"
                            />
                        </div>

                        {passwordMessage && (
                            <div className={`p-3 rounded-lg text-sm border flex items-start gap-2 ${passwordMessage.type === 'success' ? 'bg-ops-success-soft border-ops-success/20 text-ops-success' : 'bg-ops-danger-soft border-ops-danger/20 text-ops-danger'}`}>
                                {passwordMessage.text}
                            </div>
                        )}

                        <div className="pt-2">
                            <button
                                type="submit"
                                disabled={isPendingPassword || !currentPassword || !newPassword || !confirmPassword}
                                className="h-10 px-6 bg-ops-surface-raised hover:bg-ops-surface-raised disabled:opacity-50 text-ops-text font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                            >
                                {isPendingPassword && <Loader2 className="size-4 animate-spin" />}
                                Perbarui Password
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}
