"use client";

import { useState } from "react";
import PhotoModal from "./photo-modal";

export default function PhotoModalTrigger({ photoPath, deviceName }: { photoPath: string; deviceName?: string }) {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <>
            <button
                type="button"
                onClick={() => setIsOpen(true)}
                className="text-blue-400 hover:text-blue-300 shrink-0 outline-none"
                title="View photo"
            >
                <span className="material-symbols-outlined text-sm">photo</span>
            </button>

            {isOpen && (
                <PhotoModal
                    photoPath={photoPath}
                    deviceName={deviceName}
                    onClose={() => setIsOpen(false)}
                />
            )}
        </>
    );
}
