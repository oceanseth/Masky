 = 'E33L46W61GEWHI'
 = 'arn:aws:cloudfront::218827615080:function/www-redirect-masky'

 = aws cloudfront get-distribution-config --id  | ConvertFrom-Json
 = .ETag
 = .DistributionConfig

if (-not .DefaultCacheBehavior.FunctionAssociations) {
  .DefaultCacheBehavior | Add-Member -NotePropertyName FunctionAssociations -NotePropertyValue (@{ Quantity = 0; Items = @() }) -Force
}

 = @()
if (.DefaultCacheBehavior.FunctionAssociations.Items) {
   = .DefaultCacheBehavior.FunctionAssociations.Items | Where-Object { .EventType -ne 'viewer-request' }
}

 =  + @{ EventType = 'viewer-request'; FunctionARN =  }
.DefaultCacheBehavior.FunctionAssociations = @{ Quantity = .Count; Items =  }

 | ConvertTo-Json -Depth 100 | Out-File cloudfront-updated.json -Encoding utf8
aws cloudfront update-distribution --id  --if-match  --distribution-config file://cloudfront-updated.json
