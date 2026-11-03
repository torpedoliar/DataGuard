"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addVlan } from "@/actions/network";
import ActionButton from "@/components/ui/action-button";
import { Plus } from "lucide-react";

const fieldClass = "ops-input h-9 w-full px-3 text-sm";
const labelClass = "mb-1.5 block text-[13px] font-medium text-ops-muted";

export default function AddVlanForm() {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const [vlanId, setVlanId] = useState("");
    const [name, setName] = useState("");
    const [subnet, setSubnet] = useState("");
    const [description, setDescription] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setSuccess(null);

        if (!vlanId || !name) {
            setError("VLAN ID and Name are required.");
            return;
        }

        const vlanNumber = parseInt(vlanId);
        if (isNaN(vlanNumber) || vlanNumber < 1 || vlanNumber > 4094) {
            setError("VLAN ID must be between 1 and 4094.");
            return;
        }

        startTransition(async () => {
            try {
                await addVlan({
                    vlanId: vlanNumber,
                    name,
                    subnet: subnet || undefined,
                    description: description || undefined
                });
                setSuccess("VLAN added successfully!");
                setVlanId("");
                setName("");
                setSubnet("");
                setDescription("");
                router.refresh();
                setTimeout(() => setSuccess(null), 3000);
            } catch (err: unknown) {
                const error = err as Error;
                setError(error.message || "Failed to add VLAN.");
            }
        });
    };

    return (
        <form onSubmit={handleSubmit} className="ops-panel p-6">
            <h3 className="mb-4 flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em] text-ops-text">
                <Plus className="size-4 text-ops-accent" />
                Add new VLAN
            </h3>

            <div className="grid gap-6 md:grid-cols-4">
                <div>
                    <label htmlFor="vlanId" className={labelClass}>
                        VLAN ID *
                    </label>
                    <input
                        type="number"
                        id="vlanId"
                        value={vlanId}
                        onChange={(e) => setVlanId(e.target.value)}
                        className={fieldClass}
                        placeholder="10"
                        min="1"
                        max="4094"
                        required
                        disabled={isPending}
                    />
                </div>
                <div>
                    <label htmlFor="name" className={labelClass}>
                        VLAN Name *
                    </label>
                    <input
                        type="text"
                        id="name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className={fieldClass}
                        placeholder="Management"
                        required
                        disabled={isPending}
                    />
                </div>
                <div>
                    <label htmlFor="subnet" className={labelClass}>
                        Subnet (Optional)
                    </label>
                    <input
                        type="text"
                        id="subnet"
                        value={subnet}
                        onChange={(e) => setSubnet(e.target.value)}
                        className={fieldClass}
                        placeholder="192.168.10.0/24"
                        disabled={isPending}
                    />
                </div>
                <div>
                    <label htmlFor="description" className={labelClass}>
                        Description (Optional)
                    </label>
                    <input
                        type="text"
                        id="description"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        className={fieldClass}
                        placeholder="Core servers network"
                        disabled={isPending}
                    />
                </div>
            </div>

            {error && <p className="mt-4 text-[13px] text-ops-danger">{error}</p>}
            {success && <p className="mt-4 text-[13px] text-ops-success">{success}</p>}

            <div className="mt-6 flex justify-end">
                <ActionButton type="submit" isPending={isPending} icon={<Plus className="size-4" />}>
                    Add VLAN
                </ActionButton>
            </div>
        </form>
    );
}
