import Image from "next/image";

export default function BrandLogo({ priority = false }: { priority?: boolean }) {
  return (
    <Image
      className="cutz-bangs-logo"
      src="/cutz-bangs-logo.png"
      alt="Cutz & Bangs Unisex Salon"
      width={2048}
      height={714}
      priority={priority}
      sizes="(max-width: 600px) 132px, 160px"
    />
  );
}
