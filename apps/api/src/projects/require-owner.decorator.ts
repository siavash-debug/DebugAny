import { SetMetadata } from "@nestjs/common";
import { REQUIRE_OWNER } from "./project-access.guard";

/** Restricts a project route to members with the OWNER role. */
export const RequireOwner = () => SetMetadata(REQUIRE_OWNER, true);
