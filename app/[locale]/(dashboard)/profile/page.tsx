import { verifySession } from "@/lib/session";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import ProfileForm from "@/components/profile/profile-form";
import PageHeader from "@/components/ui/page-header";

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
        <main className="mx-auto flex w-full max-w-[1200px] animate-enter flex-col gap-6 px-4 py-6 lg:px-8">
            <PageHeader
                eyebrow="Account / Profile"
                title="Profile settings"
                description="Kelola foto profil dan keamanan akun Anda."
            />
            <ProfileForm user={userData} />
        </main>
    );
}
