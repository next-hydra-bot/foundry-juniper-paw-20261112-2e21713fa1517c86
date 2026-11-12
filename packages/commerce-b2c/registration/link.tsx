import { getTranslations } from "@repo/i18n";
import { Link } from "@repo/i18n/navigation";

export async function CustomerRegistrationLink() {
  const t = await getTranslations("web.customerAccount");
  return (
    <Link className="text-primary underline" href="/register/personal">
      {t("customerRegistration")}
    </Link>
  );
}
