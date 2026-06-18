import { verifySession } from "@/lib/session";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import ProfileForm from "@/components/profile/profile-form";

export const metadata = {
    title: "Profile | DataGuard",
    description: "Manage your profie and security settings.",
};

export default async function ProfilePage() {
    const session = await verifySession();

    if (!session) {
        redirect("/login");
    }

    const user = await db.query.users.findFirst({
        where: eq(users.id, session.userId),
        columns: {
            username: true,
            role: true,
            photoPath: true,
            email: true,
        },
    });

    if (!user) {
        redirect("/login");
    }

    // Cast role back strictly to the string we expect if necessary, though drizzle handles it
    const userData = {
        username: user.username,
        role: user.role,
        photoPath: user.photoPath,
        email: user.email,
    };

    return (
        <main className="p-6">
            <div className="max-w-[1600px] mx-auto min-h-[calc(100vh-8rem)]">
                <div className="mb-8">
                    <h1 className="text-3xl font-bold tracking-tight text-white mb-2">Profile Settings</h1>
                    <p className="text-slate-400">Kelola foto profil dan keamanan akun Anda.</p>
                </div>

                <ProfileForm user={userData} />
            </div>
        </main>
    );
}
