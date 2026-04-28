import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

// Body for PATCH /api/admin/feed-events/:id.
//
// Server picks the right behaviour from the row's logId:
//   - logId present → require `value`; routed through correctLog so
//     scoring + multi-group fan-out cascades.
//   - logId null    → require `message` and/or `isPublic`; only the
//     FeedEvent row is touched.
// Per-field validators stay loose because the service does the
// log-vs-standalone arbitration; whitelist=true with these decorators
// just unblocks the pipe (see commit 4be0a28 for context).
export class AdminFeedEditDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  value?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}
