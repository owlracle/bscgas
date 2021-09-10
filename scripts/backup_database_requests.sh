##!/bin/bash

DATA=`date +%Y-%m-%d-%H-%M`

mysqldump bscgas_ api_requests > requests-$DATA.sql
gzip requests-$DATA.sql
rclone copy requests-$DATA.sql.gz gdrive:/1NOSYNC/bscgas_backup/
rm -rf requests-$DATA.sql.gz

