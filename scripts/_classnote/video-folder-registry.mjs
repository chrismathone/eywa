export function videoFolderRegistry(sql, tenant, root) {
  return {
    async find(key) {
      const [row] = await sql`select drive_folder_id from classnote_video_folders
        where tenant_id=${tenant} and root_folder_id=${root} and route_key=${key}`;
      return row?.drive_folder_id ?? null;
    },
    async reserve(key, proposedId) {
      const [row] = await sql`insert into classnote_video_folders (tenant_id,root_folder_id,route_key,drive_folder_id)
        values (${tenant},${root},${key},${proposedId})
        on conflict (tenant_id,root_folder_id,route_key) do update set drive_folder_id=classnote_video_folders.drive_folder_id
        returning drive_folder_id`;
      return row.drive_folder_id;
    },
  };
}

export function videoFileRegistry(sql, tenant) {
  return { async reserve(folder, video, proposedId) {
    const [row] = await sql`insert into classnote_video_files (tenant_id,folder_id,md5,bytes,drive_file_id)
      values (${tenant},${folder},${video.md5},${video.bytes},${proposedId})
      on conflict (tenant_id,folder_id,md5,bytes) do update set drive_file_id=classnote_video_files.drive_file_id
      returning drive_file_id`;
    return row.drive_file_id;
  } };
}
