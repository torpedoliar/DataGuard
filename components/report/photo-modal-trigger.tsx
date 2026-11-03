"use client";

import { useState } from "react";
import { Image as ImageIcon } from "lucide-react";
import PhotoModal from "./photo-modal";

export default function PhotoModalTrigger({ photoPath, deviceName }: { photoPath: string; deviceName?: string }) {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <>
            <button
                type="button"
                onClick={(e) => {
                    e.stopPropagation();
                    setIsOpen(true);
                }}
                className="text-ops-info hover:text-ops-info shrink-0 outline-none"
                title="View photo"
            >
                <ImageIcon className="size-4" aria-hidden="true" />
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
